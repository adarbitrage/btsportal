import { getRedis } from "./redis";

// Hourly sweep is paired with the middleware-level per-key cap as a
// belt-and-suspenders backstop. The middleware (see `abuse-rate-limit.ts`)
// is the primary bounded-memory control via ZREMRANGEBYRANK on every write;
// this job exists to clean up any stragglers or empty keys that survive
// past their TTL.
const RUN_INTERVAL_MS = 60 * 60 * 1000;

// Every key written by `abuseRateLimit` follows the shape
// `abuse-rate:{routeName}:{routePrefix}:{ip|email}:{identifier}` and the
// values are sorted-set members scored by Date.now() in milliseconds. This
// pattern matches every route that uses the shared middleware, so the
// cleanup is route-agnostic. Any future route that calls `abuseRateLimit`
// is automatically covered.
const KEY_PATTERN = "abuse-rate:*";
const SCAN_BATCH = 200;

// The sweep removes sorted-set members whose score (timestamp) is older
// than `now - SWEEP_HORIZON_MS`. The horizon must be at least as large as
// the longest window any caller of `abuseRateLimit` configures, otherwise
// the sweep would silently truncate in-window entries and weaken those
// limits. Today every caller uses a 15-minute window, so 1h is safe with
// 4× headroom; bump `ABUSE_RATE_CLEANUP_HORIZON_SECONDS` if a longer
// window is ever introduced.
const SWEEP_HORIZON_MS = (() => {
  const raw = process.env.ABUSE_RATE_CLEANUP_HORIZON_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed * 1000;
  }
  return 60 * 60 * 1000;
})();

export interface AbuseRateLimitCleanupResult {
  scanned: number;
  trimmed: number;
  deleted: number;
}

export async function runAbuseRateLimitCleanup(): Promise<AbuseRateLimitCleanupResult> {
  const redis = getRedis();
  const stats: AbuseRateLimitCleanupResult = { scanned: 0, trimmed: 0, deleted: 0 };
  if (!redis) return stats;

  const cutoff = Date.now() - SWEEP_HORIZON_MS;
  let cursor = "0";

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      KEY_PATTERN,
      "COUNT",
      SCAN_BATCH,
    );
    cursor = nextCursor;

    for (const key of keys) {
      stats.scanned++;
      try {
        const removed = await redis.zremrangebyscore(key, 0, cutoff);
        if (removed > 0) stats.trimmed += removed;
        const remaining = await redis.zcard(key);
        if (remaining === 0) {
          const wasDeleted = await redis.del(key);
          if (wasDeleted > 0) stats.deleted++;
        }
      } catch (err) {
        console.error(
          `[AbuseRateLimitCleanup] Failed to clean key ${key}:`,
          (err as Error)?.message || err,
        );
      }
    }
  } while (cursor !== "0");

  if (stats.trimmed > 0 || stats.deleted > 0) {
    console.log(
      `[AbuseRateLimitCleanup] Scanned ${stats.scanned} key(s); trimmed ${stats.trimmed} stale entry(ies); deleted ${stats.deleted} empty key(s)`,
    );
  }
  return stats;
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startAbuseRateLimitCleanupJob(): void {
  if (jobInterval) return;
  if (!process.env.REDIS_URL) return;
  jobInterval = setInterval(() => {
    runAbuseRateLimitCleanup().catch((err) => {
      console.error("[AbuseRateLimitCleanup] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[AbuseRateLimitCleanup] Started cleanup job (every ${RUN_INTERVAL_MS / 60000}m, horizon ${SWEEP_HORIZON_MS / 60000}m)`,
  );
  runAbuseRateLimitCleanup().catch((err) => {
    console.error("[AbuseRateLimitCleanup] Initial run failed:", err);
  });
}

export function stopAbuseRateLimitCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
