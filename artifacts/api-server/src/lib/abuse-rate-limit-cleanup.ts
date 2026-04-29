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

export interface AbuseRateLimitCleanupStatus {
  enabled: boolean;
  intervalMs: number;
  lastRanAt: string | null;
  lastResult: AbuseRateLimitCleanupResult | null;
  lastError: { at: string; message: string } | null;
  stale: boolean;
}

// Surfaced to the admin System Health page so on-call can confirm the sweep
// is still running and has trimmed memory recently. The status is updated at
// the end of every `runAbuseRateLimitCleanup` call (success OR failure), so
// `lastRanAt` doubles as a heartbeat and a silent crash in the inner loop
// still flips the panel out of "Pending".
let lastRanAt: Date | null = null;
let lastResult: AbuseRateLimitCleanupResult | null = null;
let lastError: { at: Date; message: string } | null = null;

// Baseline used to compute staleness when the job has not yet reported a
// run. Set at module load — which in production is process start, the same
// moment `startAbuseRateLimitCleanupJob` would have started running. If the
// job is supposed to be running (REDIS_URL set) but no run shows up after
// 2 intervals from this baseline, the System Health panel surfaces it as
// stale instead of leaving it on "Pending" forever.
let baselineSince: Date = new Date();

export async function runAbuseRateLimitCleanup(): Promise<AbuseRateLimitCleanupResult> {
  const stats: AbuseRateLimitCleanupResult = { scanned: 0, trimmed: 0, deleted: 0 };
  try {
    const redis = getRedis();
    if (!redis) {
      return stats;
    }

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

    lastError = null;
    return stats;
  } catch (err) {
    // Outer-loop failures (e.g. SCAN throws) used to leave `lastRanAt`
    // unchanged, so a job that broke immediately would look like it had
    // never run. We record a heartbeat on the failure path and remember
    // the error so the System Health page can surface it.
    lastError = {
      at: new Date(),
      message: (err as Error)?.message ?? String(err),
    };
    throw err;
  } finally {
    lastRanAt = new Date();
    lastResult = stats;
  }
}

export function getAbuseRateLimitCleanupStatus(): AbuseRateLimitCleanupStatus {
  const enabled = Boolean(process.env.REDIS_URL);
  // When the job has never reported a run we fall back to the module-load
  // baseline: if the process has been up longer than 2 intervals without a
  // single sweep landing, that is itself a regression worth surfacing.
  const referenceTs = (lastRanAt ?? baselineSince).getTime();
  const stale = enabled && Date.now() - referenceTs > 2 * RUN_INTERVAL_MS;
  return {
    enabled,
    intervalMs: RUN_INTERVAL_MS,
    lastRanAt: lastRanAt ? lastRanAt.toISOString() : null,
    lastResult: lastResult ? { ...lastResult } : null,
    lastError: lastError
      ? { at: lastError.at.toISOString(), message: lastError.message }
      : null,
    stale,
  };
}

// Test hook: reset the in-memory status back to its initial state so each
// test can assert against a clean slate. Not intended for production use.
export function __resetAbuseRateLimitCleanupStatusForTests(): void {
  lastRanAt = null;
  lastResult = null;
  lastError = null;
  baselineSince = new Date();
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
