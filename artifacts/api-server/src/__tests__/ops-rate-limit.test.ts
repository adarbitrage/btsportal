/**
 * Focused unit tests for the ops rate-limit middleware (no DB/app needed).
 *
 * Covers the two "never fail open" guarantees that the integration suite
 * (ops-refund.test.ts) can't easily exercise because it always runs with
 * Redis unavailable (`getRedis: () => null`):
 *   1. A configured-but-failing Redis client (multi().exec() rejects) falls
 *      back to the bounded in-memory limiter — request still gets blocked
 *      once the cap is hit.
 *   2. A Redis client whose transaction is DISCARDED (multi().exec()
 *      resolves null, e.g. WATCH conflict) must NOT be treated as "allow" —
 *      it must also route to the bounded in-memory fallback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { type Request, type Response } from "express";

type ExecResult = Array<[Error | null, unknown]> | null;

function makeFakeRedisClient(execResult: ExecResult | (() => Promise<ExecResult>)) {
  const multiChain = {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    zremrangebyrank: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn(async () => {
      if (typeof execResult === "function") return execResult();
      return execResult;
    }),
  };
  return {
    multi: vi.fn(() => multiChain),
    zrem: vi.fn().mockResolvedValue(1),
  };
}

let fakeRedis: ReturnType<typeof makeFakeRedisClient> | null = null;

vi.mock("../lib/redis", () => ({
  getRedis: () => fakeRedis,
  isRedisConnected: async () => fakeRedis !== null,
}));

function makeReqRes(bearerToken: string) {
  const req = {
    headers: { authorization: `Bearer ${bearerToken}` },
    ip: "203.0.113.7",
  } as unknown as Request;

  const headers: Record<string, unknown> = {};
  let statusCode = 200;
  let jsonBody: unknown;
  const res = {
    req,
    setHeader: vi.fn((k: string, v: unknown) => { headers[k] = v; }),
    status: vi.fn((code: number) => { statusCode = code; return res; }),
    json: vi.fn((body: unknown) => { jsonBody = body; return res; }),
  } as unknown as Response;

  return { req, res, getStatus: () => statusCode, getJson: () => jsonBody, getHeaders: () => headers };
}

describe("ops rate limiter — never fails open when Redis is configured but unreliable", () => {
  const WRITE_MAX_ENV = "BTS_OPS_RATE_LIMIT_WRITE_MAX";
  const WRITE_WINDOW_ENV = "BTS_OPS_RATE_LIMIT_WRITE_WINDOW_SEC";

  beforeEach(() => {
    process.env[WRITE_MAX_ENV] = "1";
    process.env[WRITE_WINDOW_ENV] = "600";
    fakeRedis = null;
    vi.resetModules();
  });

  it("falls back to bounded in-memory (still enforces the cap) when redis.multi().exec() rejects", async () => {
    const { opsWriteKeyLimiter, __resetOpsRateLimitStateForTests } = await import("../middleware/ops-rate-limit");
    __resetOpsRateLimitStateForTests();
    fakeRedis = makeFakeRedisClient(() => Promise.reject(new Error("ECONNREFUSED")));

    const token = `token-exec-reject-${Math.random()}`;
    const first = makeReqRes(token);
    const next1 = vi.fn();
    await new Promise<void>((resolve) => {
      opsWriteKeyLimiter(first.req, first.res, () => { next1(); resolve(); });
    });
    expect(next1).toHaveBeenCalledTimes(1);
    expect(first.getStatus()).toBe(200);

    const second = makeReqRes(token);
    const next2 = vi.fn();
    await new Promise<void>((resolve) => {
      opsWriteKeyLimiter(second.req, second.res, () => { next2(); resolve(); });
      // In case next() is never called (blocked), resolve once status/json fires.
      setTimeout(resolve, 50);
    });
    expect(next2).not.toHaveBeenCalled();
    expect(second.getStatus()).toBe(429);
  });

  it("falls back to bounded in-memory (still enforces the cap) when redis.multi().exec() resolves null (discarded transaction)", async () => {
    const { opsWriteKeyLimiter, __resetOpsRateLimitStateForTests } = await import("../middleware/ops-rate-limit");
    __resetOpsRateLimitStateForTests();
    fakeRedis = makeFakeRedisClient(null);

    const token = `token-exec-null-${Math.random()}`;
    const first = makeReqRes(token);
    const next1 = vi.fn();
    await new Promise<void>((resolve) => {
      opsWriteKeyLimiter(first.req, first.res, () => { next1(); resolve(); });
      setTimeout(resolve, 50);
    });
    expect(next1).toHaveBeenCalledTimes(1);
    expect(first.getStatus()).toBe(200);

    const second = makeReqRes(token);
    const next2 = vi.fn();
    await new Promise<void>((resolve) => {
      opsWriteKeyLimiter(second.req, second.res, () => { next2(); resolve(); });
      setTimeout(resolve, 50);
    });

    // The critical assertion: a discarded/null transaction must never be
    // treated as "allow" — the second request against the same 1-request
    // cap must still be blocked via the in-memory fallback, not pass
    // straight through because Redis technically "succeeded" with null.
    expect(next2).not.toHaveBeenCalled();
    expect(second.getStatus()).toBe(429);
  });
});
