/**
 * Integration test for cross-process moderation-wordlist cache invalidation.
 *
 * The moderation engine caches the wordlist in-process for 60s. In a
 * multi-process deploy, an admin edit to the wordlist needs to drop every
 * process's cache — not just the one that handled the mutation. We do that
 * by publishing on a Redis pub/sub channel; subscribers in every process
 * clear their local cache when the message arrives.
 *
 * This test simulates "another process" by publishing the invalidation
 * directly from a separate ioredis client, then asserts that the wordlist
 * module's subscriber clears its cache so the next `scanContent()` re-reads
 * from the DB stub.
 *
 * Gating: opt-in via `RUN_REDIS_INTEGRATION_TESTS=1` (see
 * `helpers/real-redis.ts`), so default `pnpm test` runs are unaffected.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  RUN_REDIS_INTEGRATION,
  redisUrl,
  startRealRedis,
  stopRealRedis,
  type RealRedis,
} from "./helpers/real-redis";

let realRedis: RealRedis | null = null;

type Row = { id: number; word: string; category: string; severity: "HARD" | "SOFT" };

let currentRows: Row[] = [];

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: async () => currentRows }),
  },
  moderationWordlistTable: {},
}));

type WordlistModule = typeof import("../lib/moderation/wordlist");
type RedisLibModule = typeof import("../lib/redis");

let wordlistMod: WordlistModule;
let redisLibMod: RedisLibModule;

describe.runIf(RUN_REDIS_INTEGRATION)(
  "moderation wordlist cross-process invalidation",
  () => {
    beforeAll(async () => {
      realRedis = await startRealRedis();
      process.env.REDIS_URL = redisUrl(realRedis);
      // Import AFTER REDIS_URL is set so the lib/redis module captures it.
      redisLibMod = await import("../lib/redis");
      wordlistMod = await import("../lib/moderation/wordlist");
      wordlistMod.subscribeWordlistInvalidations();
      // Give the subscriber a moment to register with Redis.
      await new Promise((r) => setTimeout(r, 200));
    }, 30_000);

    afterAll(async () => {
      if (wordlistMod) await wordlistMod.stopWordlistInvalidations();
      await stopRealRedis(realRedis);
      realRedis = null;
      delete process.env.REDIS_URL;
    });

    it("drops the in-process cache when another process publishes an invalidation", async () => {
      currentRows = [
        { id: 1, word: "foo", category: "test", severity: "HARD" },
      ];

      // Prime the cache.
      expect(await wordlistMod.scanContent("foo")).toHaveLength(1);
      expect(await wordlistMod.scanContent("bar")).toHaveLength(0);

      // Another "process" adds a row and publishes an invalidation.
      currentRows = [
        { id: 1, word: "foo", category: "test", severity: "HARD" },
        { id: 2, word: "bar", category: "test", severity: "HARD" },
      ];
      const publisher = redisLibMod.createRedisConnection();
      await publisher.publish(
        "moderation:wordlist:invalidate",
        JSON.stringify({ instanceId: "another-process", ts: Date.now() }),
      );
      await publisher.quit();

      // Wait for the message to land.
      await new Promise((r) => setTimeout(r, 300));

      // The next scan must reflect the new row — proving the cache was
      // dropped by the cross-process message, not by the 60s TTL.
      expect(await wordlistMod.scanContent("bar")).toHaveLength(1);
    }, 15_000);

    it("does not loop on self-published invalidations", async () => {
      // Calling invalidateWordlistCache() publishes a message. The subscriber
      // tags messages with INSTANCE_ID and skips its own to avoid an extra
      // (harmless but wasteful) cache clear. This test just confirms the
      // call completes and the cache works normally afterward.
      currentRows = [{ id: 1, word: "baz", category: "test", severity: "HARD" }];
      wordlistMod.invalidateWordlistCache();
      await new Promise((r) => setTimeout(r, 200));
      expect(await wordlistMod.scanContent("baz")).toHaveLength(1);
    }, 10_000);
  },
);
