import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const { redisGetMock, sortedSets, hashes } = vi.hoisted(() => {
  const sortedSets = new Map<string, Array<{ score: number; member: string }>>();
  const hashes = new Map<string, Map<string, string>>();

  function buildMulti() {
    const ops: Array<() => unknown> = [];
    const results: Array<[Error | null, unknown]> = [];
    const multi: any = {
      zremrangebyscore(key: string, _min: number, max: number) {
        ops.push(() => {
          const arr = sortedSets.get(key) || [];
          const kept = arr.filter((e) => e.score > max);
          sortedSets.set(key, kept);
          results.push([null, arr.length - kept.length]);
        });
        return multi;
      },
      zcard(key: string) {
        ops.push(() => {
          const arr = sortedSets.get(key) || [];
          results.push([null, arr.length]);
        });
        return multi;
      },
      zadd(key: string, score: number, member: string) {
        ops.push(() => {
          const arr = sortedSets.get(key) || [];
          arr.push({ score, member });
          sortedSets.set(key, arr);
          results.push([null, 1]);
        });
        return multi;
      },
      zremrangebyrank(_key: string, _start: number, _stop: number) {
        ops.push(() => results.push([null, 0]));
        return multi;
      },
      expire(_key: string, _seconds: number) {
        ops.push(() => results.push([null, 1]));
        return multi;
      },
      // The audit-failure tracker pipelines DEL + HSET + EXPIRE on every
      // failure to mirror this pod's snapshot to a per-pod hash. Mirror
      // those ops here so the test exercises the real code path without
      // tripping over "is not a function" errors at the multi-builder.
      del(key: string) {
        ops.push(() => {
          const existed = hashes.delete(key);
          results.push([null, existed ? 1 : 0]);
        });
        return multi;
      },
      hset(key: string, ...fieldsAndValues: Array<string | number>) {
        ops.push(() => {
          const m = hashes.get(key) ?? new Map<string, string>();
          for (let i = 0; i < fieldsAndValues.length; i += 2) {
            m.set(String(fieldsAndValues[i]), String(fieldsAndValues[i + 1]));
          }
          hashes.set(key, m);
          results.push([null, 1]);
        });
        return multi;
      },
      async exec() {
        for (const op of ops) op();
        return results;
      },
    };
    return multi;
  }

  const fakeRedis: any = {
    multi: buildMulti,
    async zrem(key: string, member: string) {
      const arr = sortedSets.get(key) || [];
      const next = arr.filter((e) => e.member !== member);
      sortedSets.set(key, next);
      return arr.length - next.length;
    },
    async scan(cursor: string, _match: string, pattern: string, _count: string, _n: number) {
      // Emulate just enough of SCAN to return all matching keys in one
      // sweep — matches the small keyspace sizes this tracker creates.
      const re = new RegExp(
        "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
      );
      const matches = Array.from(hashes.keys()).filter((k) => re.test(k));
      return [cursor === "0" ? "0" : "0", matches];
    },
    async hgetall(key: string) {
      const m = hashes.get(key);
      if (!m) return {};
      return Object.fromEntries(m.entries());
    },
  };

  return { redisGetMock: vi.fn(() => fakeRedis), sortedSets, hashes };
});

vi.mock("../lib/redis", () => ({
  getRedis: redisGetMock,
}));

import { abuseRateLimit, ipKey } from "../middleware/abuse-rate-limit";
import {
  getRateLimitAuditFailureStats,
  __resetRateLimitAuditFailureTrackerForTests,
} from "../lib/rate-limit-audit-failure-tracker";
import { requestIdMiddleware, apiErrorHandler } from "../lib/api-errors";

const LIMITER_NAME = "test-limiter";

function buildAppWithFailingHook(hookError: unknown) {
  const app = express();
  app.use(express.json());
  app.use("/api", requestIdMiddleware);
  app.use(
    "/api/test",
    abuseRateLimit({
      name: LIMITER_NAME,
      maxRequests: 1,
      windowSeconds: 60,
      keyResolver: ipKey("test"),
      onLimitExceeded: async () => {
        // Mirrors what `recordAuthRateLimitHit` does on a database outage:
        // the audit insert throws and the tracker should still emit a 429.
        throw hookError;
      },
    }),
    (_req, res) => {
      res.status(204).end();
    },
  );
  app.use("/api", apiErrorHandler);
  return app;
}

beforeEach(() => {
  sortedSets.clear();
  redisGetMock.mockClear();
  __resetRateLimitAuditFailureTrackerForTests();
});

describe("abuseRateLimit audit-failure tracking", () => {
  it("still serves the 429 AND increments the failure counter when onLimitExceeded throws", async () => {
    const app = buildAppWithFailingHook(new Error("audit insert failed"));

    // Burn the per-IP budget (max=1). The first request gets through.
    const ok = await request(app).get("/api/test");
    expect(ok.status).toBe(204);

    // Counter should be untouched while we're under the cap — the audit hook
    // only fires on a 429.
    expect(getRateLimitAuditFailureStats().totalCount).toBe(0);

    // Next request must be blocked. The audit hook throws, but the response
    // should STILL be a 429 (failing the request because audit logging is
    // broken would let an attacker DoS the limiter into 5xxs).
    const blocked = await request(app).get("/api/test");
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");

    // The counter should now reflect the dropped audit row.
    const stats = getRateLimitAuditFailureStats();
    expect(stats.totalCount).toBe(1);
    expect(stats.byName[LIMITER_NAME]?.count).toBe(1);
    expect(stats.byName[LIMITER_NAME]?.lastError).toBe("audit insert failed");
    expect(stats.lastAt).not.toBeNull();
  });

  it("accumulates the counter across repeated audit failures and tracks the most recent error", async () => {
    const app = buildAppWithFailingHook(new Error("first error"));

    // Open the limiter, then trip it twice in a row.
    await request(app).get("/api/test");
    const blocked1 = await request(app).get("/api/test");
    const blocked2 = await request(app).get("/api/test");

    expect(blocked1.status).toBe(429);
    expect(blocked2.status).toBe(429);

    const stats = getRateLimitAuditFailureStats();
    expect(stats.totalCount).toBe(2);
    expect(stats.byName[LIMITER_NAME]?.count).toBe(2);
    // The hook keeps throwing the same error reference, so the description
    // should still reflect it.
    expect(stats.byName[LIMITER_NAME]?.lastError).toBe("first error");
  });

  it("does not bump the counter when the hook succeeds", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", requestIdMiddleware);
    let hookCalls = 0;
    app.use(
      "/api/ok",
      abuseRateLimit({
        name: "ok-limiter",
        maxRequests: 1,
        windowSeconds: 60,
        keyResolver: ipKey("ok"),
        onLimitExceeded: async () => {
          hookCalls++;
        },
      }),
      (_req, res) => {
        res.status(204).end();
      },
    );
    app.use("/api", apiErrorHandler);

    await request(app).get("/api/ok");
    const blocked = await request(app).get("/api/ok");

    expect(blocked.status).toBe(429);
    expect(hookCalls).toBe(1);
    expect(getRateLimitAuditFailureStats().totalCount).toBe(0);
  });
});
