/**
 * Integration test that exercises the abuse rate-limit cleanup sweep
 * against a real `redis-server` (instead of the hand-rolled fake used by
 * `abuse-rate-limit-cleanup.test.ts`).
 *
 * Why a real-Redis pass?
 * ---------------------
 * The sweep walks every `abuse-rate:*` key via SCAN, then calls
 * ZREMRANGEBYSCORE / ZCARD / DEL per key. SCAN cursor pagination, MATCH
 * pattern filtering, and the empty-set → DEL handoff all differ subtly
 * between our in-memory fake (which returns every key in one batch with
 * cursor "0") and a real Redis (which can paginate, return duplicate
 * keys across batches, or return more keys than COUNT). We want at least
 * one test that drives the real cursor protocol so a future Redis-server
 * upgrade can't silently break the cleanup.
 *
 * Gating: opt-in via `RUN_REDIS_INTEGRATION_TESTS=1` (see
 * `helpers/real-redis.ts`).
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

import type * as CleanupModule from "../lib/abuse-rate-limit-cleanup";
import type * as RedisModule from "../lib/redis";

let cleanupMod: typeof CleanupModule;
let redisMod: typeof RedisModule;
let realRedis: RealRedis | null = null;

const HOUR_MS = 60 * 60 * 1000;

describe.runIf(RUN_REDIS_INTEGRATION)(
  "abuse rate-limit cleanup against a real Redis",
  () => {
    beforeAll(async () => {
      realRedis = await startRealRedis();
      process.env.REDIS_URL = redisUrl(realRedis);
      cleanupMod = await import("../lib/abuse-rate-limit-cleanup");
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
      cleanupMod.__resetAbuseRateLimitCleanupStatusForTests();
    });

    it("trims stale entries and deletes emptied keys against real Redis", async () => {
      const r = redisMod.getRedis()!;
      const now = Date.now();

      // Three keys with a mix of "older than horizon" and "in-window" entries.
      // The default horizon is 1h, so anything older than that is stale.
      await r.zadd("abuse-rate:register:email:abc", now - 2 * HOUR_MS, "old-1");
      await r.zadd(
        "abuse-rate:register:email:abc",
        now - 90 * 60 * 1000,
        "old-2",
      );
      await r.zadd("abuse-rate:login:ip:1.2.3.4", now - 30 * 60 * 1000, "fresh-1");
      await r.zadd("abuse-rate:login:ip:1.2.3.4", now - 10 * 60 * 1000, "fresh-2");
      await r.zadd("abuse-rate:reset:ip:5.6.7.8", now - 3 * HOUR_MS, "old-3");
      await r.zadd("abuse-rate:reset:ip:5.6.7.8", now - 5 * 60 * 1000, "fresh-3");

      // A non-matching key that the SCAN MATCH filter must skip; if MATCH
      // misbehaves (e.g. wrong glob semantics on a server upgrade) this
      // would inflate `scanned`.
      await r.zadd("other:not-abuse:x", now, "ignored");

      const result = await cleanupMod.runAbuseRateLimitCleanup();

      expect(result.scanned).toBe(3);
      expect(result.trimmed).toBe(3);
      expect(result.deleted).toBe(1);

      // The fully-stale key should be gone, the other two should retain
      // exactly the fresh entries.
      expect(await r.exists("abuse-rate:register:email:abc")).toBe(0);
      expect(await r.zcard("abuse-rate:login:ip:1.2.3.4")).toBe(2);
      const resetMembers = await r.zrange("abuse-rate:reset:ip:5.6.7.8", 0, -1);
      expect(resetMembers).toEqual(["fresh-3"]);
      // The non-matching key must still be present.
      expect(await r.exists("other:not-abuse:x")).toBe(1);
    });

    it("paginates correctly across many SCAN batches (cursor protocol)", async () => {
      // The sweep's SCAN COUNT hint is 200. Real Redis is free to return
      // more or fewer keys per batch and may need many cursor round-trips.
      // We insert 1000 keys here so the real cursor loop is the only way
      // we'd see every key — a buggy cursor handoff would scan too few.
      const r = redisMod.getRedis()!;
      const now = Date.now();
      const pipeline = r.pipeline();
      for (let i = 0; i < 1000; i++) {
        pipeline.zadd(`abuse-rate:bulk:ip:${i}`, now - 2 * HOUR_MS, `m-${i}`);
      }
      await pipeline.exec();

      const result = await cleanupMod.runAbuseRateLimitCleanup();

      expect(result.scanned).toBe(1000);
      expect(result.trimmed).toBe(1000);
      expect(result.deleted).toBe(1000);

      // No abuse-rate keys should remain.
      const remaining = await r.keys("abuse-rate:*");
      expect(remaining).toEqual([]);
    });

    it("leaves fully in-window keys untouched", async () => {
      // Idempotency check against real Redis: a sweep with nothing to do
      // must not delete or trim any in-window data.
      const r = redisMod.getRedis()!;
      const now = Date.now();
      await r.zadd("abuse-rate:login:ip:9.9.9.9", now - 5 * 60 * 1000, "fresh-a");
      await r.zadd("abuse-rate:login:ip:9.9.9.9", now - 1 * 60 * 1000, "fresh-b");

      const result = await cleanupMod.runAbuseRateLimitCleanup();
      expect(result.scanned).toBe(1);
      expect(result.trimmed).toBe(0);
      expect(result.deleted).toBe(0);
      expect(await r.zcard("abuse-rate:login:ip:9.9.9.9")).toBe(2);
    });
  },
);
