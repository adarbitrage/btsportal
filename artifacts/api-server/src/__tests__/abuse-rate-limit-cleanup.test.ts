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

import { runAbuseRateLimitCleanup } from "../lib/abuse-rate-limit-cleanup";

const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
  sortedSets.clear();
  ttls.clear();
  redisGetMock.mockClear();
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
