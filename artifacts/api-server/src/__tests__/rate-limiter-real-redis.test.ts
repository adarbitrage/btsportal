/**
 * Integration test that exercises the Redis-backed sliding-window rate
 * limiter middleware against a real `redis-server` (instead of the mocked
 * Redis used by `rate-limiter.test.ts` / `auth-rate-limit.test.ts`).
 *
 * Why a real-Redis pass?
 * ---------------------
 * The middleware fans out a MULTI of ZREMRANGEBYSCORE / ZRANGEBYSCORE /
 * ZADD / EXPIRE and decides allow vs. 429 from the ZRANGEBYSCORE reply's
 * member count. The exact shape of that reply (array of bulk-strings,
 * empty-array encoding, EXEC pipeline indices) is the kind of detail that
 * looks fine against an in-memory fake but can drift on a Redis client or
 * server upgrade. We also want to confirm two "pods" sharing the same
 * Redis can't independently exceed the global cap — i.e. the cap is truly
 * shared, not per-process.
 *
 * Gating: opt-in via `RUN_REDIS_INTEGRATION_TESTS=1` (see
 * `helpers/real-redis.ts`), so default `pnpm test` runs are unaffected.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  RUN_REDIS_INTEGRATION,
  redisUrl,
  startRealRedis,
  stopRealRedis,
  type RealRedis,
} from "./helpers/real-redis";

import type { Request, Response, NextFunction } from "express";
import type * as RateLimiterModule from "../middleware/rate-limiter";
import type * as RedisModule from "../lib/redis";

let rateLimiterMod: typeof RateLimiterModule;
let redisMod: typeof RedisModule;

let realRedis: RealRedis | null = null;

interface FakeApiKeyContext {
  prefix: string;
  rateLimitTier: "standard" | "elevated" | "unlimited";
}

interface InvocationResult {
  status: number;
  headers: Record<string, string | number>;
  body: unknown;
  passed: boolean;
}

// Drive the middleware as if it were an Express handler. We capture
// `res.status`/`res.json`/`res.setHeader` so we can tell apart "allowed
// through" (next() called) from "429 short-circuit" (res.status(429)).
function invokeRateLimiter(
  ctx: FakeApiKeyContext,
): Promise<InvocationResult> {
  return new Promise((resolve) => {
    const headers: Record<string, string | number> = {};
    let resolved = false;
    const settle = (r: InvocationResult) => {
      if (resolved) return;
      resolved = true;
      resolve(r);
    };
    const req: Partial<Request> = {
      isApiKeyAuth: true,
      apiKeyContext: ctx as Request["apiKeyContext"],
      requestId: "test-req",
    };
    const res: Partial<Response> & {
      _status?: number;
      _body?: unknown;
    } = {
      // sendError() reads `res.req.requestId` to populate the error body,
      // so we wire `req` back onto `res` (Express does this automatically).
      // Without it, sendError throws and the rate-limiter's .catch handler
      // swallows the 429 and calls next() instead — silently turning every
      // expected 429 into a 200 in the test.
      req: req as Request,
      setHeader(name: string, value: string | number) {
        headers[name] = value;
        return res as Response;
      },
      status(code: number) {
        (res as { _status: number })._status = code;
        return res as Response;
      },
      json(body: unknown) {
        (res as { _body: unknown })._body = body;
        settle({
          status: (res as { _status?: number })._status ?? 200,
          headers,
          body,
          passed: false,
        });
        return res as Response;
      },
    };
    const next: NextFunction = () => {
      settle({
        status: 200,
        headers,
        body: null,
        passed: true,
      });
    };
    rateLimiterMod.rateLimiter(req as Request, res as Response, next);
  });
}

describe.runIf(RUN_REDIS_INTEGRATION)(
  "rate-limiter middleware against a real Redis",
  () => {
    beforeAll(async () => {
      realRedis = await startRealRedis();
      process.env.REDIS_URL = redisUrl(realRedis);
      // Import AFTER REDIS_URL is set so `../lib/redis` picks up the right
      // URL at module load.
      rateLimiterMod = await import("../middleware/rate-limiter");
      redisMod = await import("../lib/redis");
      const ok = await redisMod.isRedisConnected();
      if (!ok) throw new Error("real Redis was started but not reachable");
    }, 30_000);

    afterAll(async () => {
      try {
        await redisMod?.getRedis()?.quit();
      } catch {
        /* best effort */
      }
      delete process.env.REDIS_URL;
      await stopRealRedis(realRedis);
      realRedis = null;
    }, 30_000);

    beforeEach(async () => {
      await redisMod.getRedis()?.flushdb();
    });

    it("enforces the standard tier cap across many sequential requests against real Redis", async () => {
      // Standard tier = 60 requests / 60s. We hammer 65 sequentially; the
      // first 60 should pass, the next 5 should be 429s. This proves the
      // ZRANGEBYSCORE reply is being interpreted correctly (the in-memory
      // fake could lie about the reply shape and the test would still
      // pass — real Redis cannot).
      const ctx: FakeApiKeyContext = {
        prefix: "test-standard",
        rateLimitTier: "standard",
      };

      let passed = 0;
      let blocked = 0;
      for (let i = 0; i < 65; i++) {
        const r = await invokeRateLimiter(ctx);
        if (r.passed) passed++;
        else if (r.status === 429) blocked++;
      }
      expect(passed).toBe(60);
      expect(blocked).toBe(5);

      // The sorted set should still exist and carry a TTL — i.e. our EXPIRE
      // landed and Redis is treating the key as a real sliding window key.
      const ttl = await redisMod.getRedis()?.ttl("ratelimit:test-standard");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it("two pods hitting the same identifier concurrently still respect the global cap", async () => {
      // 60 concurrent requests for the same API key prefix, fanned across
      // two "pods" (Promise.all batches). Real Redis serializes the EXEC of
      // each MULTI atomically, so we expect exactly 60 passes and zero
      // 429s — but if our fake had drifted from real semantics (e.g. it
      // returned counts off-by-one), we'd see either spurious 429s or
      // bonus passes. Either failure mode is the bug this test catches.
      const ctx: FakeApiKeyContext = {
        prefix: "test-concurrent",
        rateLimitTier: "standard",
      };
      const podA = Array.from({ length: 30 }, () => invokeRateLimiter(ctx));
      const podB = Array.from({ length: 30 }, () => invokeRateLimiter(ctx));
      const all = await Promise.all([...podA, ...podB]);
      const passed = all.filter((r) => r.passed).length;
      const blocked = all.filter((r) => r.status === 429).length;
      expect(passed).toBe(60);
      expect(blocked).toBe(0);

      // One more request should now tip us over the cap.
      const overflow = await invokeRateLimiter(ctx);
      expect(overflow.passed).toBe(false);
      expect(overflow.status).toBe(429);
    });

    it("the elevated tier cap is shared across pods (no per-process leak)", async () => {
      // 305 concurrent requests against the elevated (300/min) tier across
      // two pods. Across both pods combined, only 300 should pass.
      const ctx: FakeApiKeyContext = {
        prefix: "test-elevated",
        rateLimitTier: "elevated",
      };
      const podA = Array.from({ length: 160 }, () => invokeRateLimiter(ctx));
      const podB = Array.from({ length: 145 }, () => invokeRateLimiter(ctx));
      const all = await Promise.all([...podA, ...podB]);
      const passed = all.filter((r) => r.passed).length;
      const blocked = all.filter((r) => r.status === 429).length;
      expect(passed).toBe(300);
      expect(blocked).toBe(5);
    });

    it("the unlimited tier bypasses the Redis path entirely", async () => {
      // Sanity: unlimited tier should never write to Redis at all. If
      // someone refactors the early-return and breaks this, the sorted set
      // will exist after the call.
      const ctx: FakeApiKeyContext = {
        prefix: "test-unlimited",
        rateLimitTier: "unlimited",
      };
      const r = await invokeRateLimiter(ctx);
      expect(r.passed).toBe(true);
      const exists = await redisMod.getRedis()?.exists("ratelimit:test-unlimited");
      expect(exists).toBe(0);
    });
  },
);
