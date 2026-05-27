import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { moderationWordlistTable } from "@workspace/db";
import { createRedisConnection, getRedis } from "../redis";

export interface WordlistMatch {
  word: string;
  category: string;
  severity: "HARD" | "SOFT";
}

interface CachedEntry {
  id: number;
  word: string;
  category: string;
  severity: "HARD" | "SOFT";
}

let cache: CachedEntry[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60_000;

const INVALIDATION_CHANNEL = "moderation:wordlist:invalidate";
const INSTANCE_ID = randomUUID();

let subscriberStarted = false;
let subscriber: ReturnType<typeof createRedisConnection> | null = null;

async function loadWordlist(): Promise<CachedEntry[]> {
  const now = Date.now();
  if (cache && now < cacheExpiry) return cache;
  const rows = await db.select().from(moderationWordlistTable);
  cache = rows.map((r) => ({
    id: r.id,
    word: r.word,
    category: r.category,
    severity: r.severity as "HARD" | "SOFT",
  }));
  cacheExpiry = now + CACHE_TTL_MS;
  return cache;
}

function clearLocalCache(): void {
  cache = null;
  cacheExpiry = 0;
}

/**
 * Invalidate the local in-process wordlist cache and, if Redis is configured,
 * broadcast the invalidation to every other API process so they drop their
 * caches on the next request as well. Safe to call when Redis is unavailable —
 * it falls back to local-only invalidation (current single-process behavior).
 */
export function invalidateWordlistCache(): void {
  clearLocalCache();
  const r = getRedis();
  if (!r) return;
  const payload = JSON.stringify({ instanceId: INSTANCE_ID, ts: Date.now() });
  r.publish(INVALIDATION_CHANNEL, payload).catch((err) => {
    console.error("[Moderation/Wordlist] Failed to publish invalidation:", err);
  });
}

/**
 * Start the cross-process invalidation subscriber. Idempotent. Should be
 * called once at process startup. If Redis is not configured, this is a no-op
 * and the cache behaves as a single-process cache (still honoring the TTL).
 */
export function subscribeWordlistInvalidations(): void {
  if (subscriberStarted) return;
  if (!process.env.REDIS_URL) return;
  subscriberStarted = true;
  try {
    subscriber = createRedisConnection();
    subscriber.on("error", (err) => {
      console.error("[Moderation/Wordlist] Subscriber error:", err.message);
    });
    subscriber.subscribe(INVALIDATION_CHANNEL, (err) => {
      if (err) {
        console.error("[Moderation/Wordlist] Failed to subscribe:", err);
      }
    });
    subscriber.on("message", (channel, message) => {
      if (channel !== INVALIDATION_CHANNEL) return;
      try {
        const parsed = JSON.parse(message) as { instanceId?: string };
        if (parsed.instanceId === INSTANCE_ID) return;
      } catch {
        // Unknown payload — invalidate to be safe.
      }
      clearLocalCache();
    });
  } catch (err) {
    subscriberStarted = false;
    console.error("[Moderation/Wordlist] Failed to start subscriber:", err);
  }
}

/**
 * Tear down the invalidation subscriber. Intended for tests; production
 * processes leave the subscriber alive for the lifetime of the process.
 */
export async function stopWordlistInvalidations(): Promise<void> {
  if (subscriber) {
    try {
      await subscriber.quit();
    } catch {
      subscriber.disconnect();
    }
    subscriber = null;
  }
  subscriberStarted = false;
}

export async function scanContent(body: string): Promise<WordlistMatch[]> {
  const wordlist = await loadWordlist();
  const lower = body.toLowerCase();
  const matches: WordlistMatch[] = [];

  for (const entry of wordlist) {
    const w = entry.word;
    const isAlphaOnly = /^[a-z]+$/.test(w);
    let found = false;
    if (isAlphaOnly) {
      const regex = new RegExp(`\\b${w}\\b`, "i");
      found = regex.test(lower);
    } else {
      found = lower.includes(w);
    }
    if (found) {
      matches.push({ word: w, category: entry.category, severity: entry.severity });
    }
  }

  return matches;
}
