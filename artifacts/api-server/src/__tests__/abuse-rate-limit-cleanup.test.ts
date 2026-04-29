import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const { sortedSets, ttls, redisGetMock } = vi.hoisted(() => {
  const sortedSets = new Map<string, Array<{ score: number; member: string }>>();
  const ttls = new Map<string, number>();

  const fakeRedis: any = {
    async scan(cursor: string, ..._args: unknown[]) {
      if (cursor !== "0") return ["0", []];
      return ["0", Array.from(sortedSets.keys())];
    },
    async zremrangebyscore(key: string, _min: number, max: number) {
      const arr = sortedSets.get(key) || [];
      const kept = arr.filter((e) => e.score > max);
      sortedSets.set(key, kept);
      return arr.length - kept.length;
    },
    async zcard(key: string) {
      return (sortedSets.get(key) || []).length;
    },
    async del(key: string) {
      const existed = sortedSets.has(key);
      sortedSets.delete(key);
      ttls.delete(key);
      return existed ? 1 : 0;
    },
  };

  const redisGetMock = vi.fn(() => fakeRedis);
  return { sortedSets, ttls, redisGetMock };
});

vi.mock("../lib/redis", () => ({
  getRedis: redisGetMock,
}));

import {
  runAbuseRateLimitCleanup,
  getAbuseRateLimitCleanupStatus,
  __resetAbuseRateLimitCleanupStatusForTests,
} from "../lib/abuse-rate-limit-cleanup";

const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
  sortedSets.clear();
  ttls.clear();
  redisGetMock.mockClear();
  __resetAbuseRateLimitCleanupStatusForTests();
});

afterEach(() => {
  sortedSets.clear();
});

describe("runAbuseRateLimitCleanup", () => {
  it("trims entries older than the sweep horizon and deletes empty keys", async () => {
    const now = Date.now();
    sortedSets.set("abuse-rate:register:email:abc", [
      { score: now - 2 * HOUR_MS, member: "old-1" },
      { score: now - 90 * 60 * 1000, member: "old-2" },
    ]);
    sortedSets.set("abuse-rate:login:ip:1.2.3.4", [
      { score: now - 30 * 60 * 1000, member: "fresh-1" },
      { score: now - 10 * 60 * 1000, member: "fresh-2" },
    ]);
    sortedSets.set("abuse-rate:reset:ip:5.6.7.8", [
      { score: now - 3 * HOUR_MS, member: "old-3" },
      { score: now - 5 * 60 * 1000, member: "fresh-3" },
    ]);

    const result = await runAbuseRateLimitCleanup();

    expect(result.scanned).toBe(3);
    expect(result.trimmed).toBe(3);
    expect(result.deleted).toBe(1);
    expect(sortedSets.has("abuse-rate:register:email:abc")).toBe(false);
    expect((sortedSets.get("abuse-rate:login:ip:1.2.3.4") || []).length).toBe(2);
    expect((sortedSets.get("abuse-rate:reset:ip:5.6.7.8") || []).map((e) => e.member)).toEqual([
      "fresh-3",
    ]);
  });

  it("works across every abuse-rate key, not register-only", async () => {
    const now = Date.now();
    sortedSets.set("abuse-rate:register:email:r", [
      { score: now - 2 * HOUR_MS, member: "old" },
    ]);
    sortedSets.set("abuse-rate:login:ip:l", [
      { score: now - 2 * HOUR_MS, member: "old" },
    ]);
    sortedSets.set("abuse-rate:reset:ip:p", [
      { score: now - 2 * HOUR_MS, member: "old" },
    ]);
    sortedSets.set("abuse-rate:future-route:email:f", [
      { score: now - 2 * HOUR_MS, member: "old" },
    ]);

    const result = await runAbuseRateLimitCleanup();
    expect(result.deleted).toBe(4);
    expect(sortedSets.size).toBe(0);
  });

  it("does nothing when redis is unavailable", async () => {
    redisGetMock.mockReturnValueOnce(null);
    const result = await runAbuseRateLimitCleanup();
    expect(result).toEqual({ scanned: 0, trimmed: 0, deleted: 0 });
  });

  it("leaves recent keys untouched", async () => {
    const now = Date.now();
    sortedSets.set("abuse-rate:register:email:keep", [
      { score: now - 1000, member: "a" },
      { score: now - 500, member: "b" },
    ]);
    const result = await runAbuseRateLimitCleanup();
    expect(result.trimmed).toBe(0);
    expect(result.deleted).toBe(0);
    expect((sortedSets.get("abuse-rate:register:email:keep") || []).length).toBe(2);
  });
});

describe("getAbuseRateLimitCleanupStatus", () => {
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(() => {
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  it("returns null lastRanAt and lastResult before the first run", () => {
    const status = getAbuseRateLimitCleanupStatus();
    expect(status.lastRanAt).toBeNull();
    expect(status.lastResult).toBeNull();
    expect(status.intervalMs).toBeGreaterThan(0);
  });

  it("populates lastRanAt and lastResult after a run", async () => {
    const now = Date.now();
    sortedSets.set("abuse-rate:register:email:run", [
      { score: now - 2 * HOUR_MS, member: "old" },
    ]);
    const before = Date.now();
    await runAbuseRateLimitCleanup();
    const after = Date.now();

    const status = getAbuseRateLimitCleanupStatus();
    expect(status.lastResult).toEqual({ scanned: 1, trimmed: 1, deleted: 1 });
    expect(status.lastRanAt).not.toBeNull();
    const ranAt = new Date(status.lastRanAt as string).getTime();
    expect(ranAt).toBeGreaterThanOrEqual(before);
    expect(ranAt).toBeLessThanOrEqual(after);
  });

  it("records a run even when redis is unavailable", async () => {
    redisGetMock.mockReturnValueOnce(null);
    await runAbuseRateLimitCleanup();
    const status = getAbuseRateLimitCleanupStatus();
    expect(status.lastResult).toEqual({ scanned: 0, trimmed: 0, deleted: 0 });
    expect(status.lastRanAt).not.toBeNull();
  });

  it("reports stale=false right after module reset, even when REDIS_URL is set", () => {
    process.env.REDIS_URL = "redis://example";
    const status = getAbuseRateLimitCleanupStatus();
    expect(status.enabled).toBe(true);
    expect(status.lastRanAt).toBeNull();
    // baseline was just reset to "now", so we are within the grace window
    expect(status.stale).toBe(false);
  });

  it("reports stale=true when the last run is older than 2× the interval and REDIS_URL is set", async () => {
    process.env.REDIS_URL = "redis://example";
    await runAbuseRateLimitCleanup();
    const status = getAbuseRateLimitCleanupStatus();
    expect(status.stale).toBe(false);

    const realNow = Date.now;
    Date.now = () => realNow() + 3 * status.intervalMs;
    try {
      const stale = getAbuseRateLimitCleanupStatus();
      expect(stale.stale).toBe(true);
      expect(stale.enabled).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("reports stale=true when the job has never reported a run and REDIS_URL is set for >2× interval", () => {
    process.env.REDIS_URL = "redis://example";
    const baseline = getAbuseRateLimitCleanupStatus();
    expect(baseline.lastRanAt).toBeNull();
    expect(baseline.stale).toBe(false);

    const realNow = Date.now;
    Date.now = () => realNow() + 3 * baseline.intervalMs;
    try {
      const stale = getAbuseRateLimitCleanupStatus();
      expect(stale.lastRanAt).toBeNull();
      expect(stale.enabled).toBe(true);
      expect(stale.stale).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("records a heartbeat and lastError when the sweep throws partway through", async () => {
    redisGetMock.mockReturnValueOnce({
      async scan() {
        throw new Error("redis exploded");
      },
    } as any);

    const before = Date.now();
    await expect(runAbuseRateLimitCleanup()).rejects.toThrow("redis exploded");
    const after = Date.now();

    const status = getAbuseRateLimitCleanupStatus();
    expect(status.lastRanAt).not.toBeNull();
    const ranAt = new Date(status.lastRanAt as string).getTime();
    expect(ranAt).toBeGreaterThanOrEqual(before);
    expect(ranAt).toBeLessThanOrEqual(after);
    expect(status.lastError?.message).toBe("redis exploded");
    // The partial result should still be the initial zeros (we never got
    // past the SCAN call), not stuck on whatever the previous run had.
    expect(status.lastResult).toEqual({ scanned: 0, trimmed: 0, deleted: 0 });
  });

  it("clears lastError on the next successful run", async () => {
    redisGetMock.mockReturnValueOnce({
      async scan() {
        throw new Error("transient");
      },
    } as any);
    await expect(runAbuseRateLimitCleanup()).rejects.toThrow("transient");
    expect(getAbuseRateLimitCleanupStatus().lastError?.message).toBe("transient");

    await runAbuseRateLimitCleanup();
    expect(getAbuseRateLimitCleanupStatus().lastError).toBeNull();
  });

  it("reports stale=false when REDIS_URL is unset, regardless of last-run age", async () => {
    delete process.env.REDIS_URL;
    await runAbuseRateLimitCleanup();
    const status = getAbuseRateLimitCleanupStatus();
    expect(status.enabled).toBe(false);
    expect(status.stale).toBe(false);

    const realNow = Date.now;
    Date.now = () => realNow() + 24 * status.intervalMs;
    try {
      const old = getAbuseRateLimitCleanupStatus();
      expect(old.stale).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });
});
