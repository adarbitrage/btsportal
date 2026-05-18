import { db, abuseRateLimitCleanupRunsTable } from "@workspace/db";
import { desc, lt } from "drizzle-orm";
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

// How long persisted run rows are retained in
// `abuse_rate_limit_cleanup_runs`. Default 7 days is enough to compare
// today's sweep volume against last week's on the System Health
// sparkline, well past the 24-entry display cap, while keeping the table
// trivially small (≤ ~168 rows at the default 1h interval). Override with
// `ABUSE_RATE_CLEANUP_RUNS_RETENTION_DAYS` if a longer window is needed.
const PERSISTED_RUNS_RETENTION_MS = (() => {
  const raw = process.env.ABUSE_RATE_CLEANUP_RUNS_RETENTION_DAYS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const days = Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
  return days * 24 * 60 * 60 * 1000;
})();

export interface AbuseRateLimitCleanupResult {
  scanned: number;
  trimmed: number;
  deleted: number;
}

export interface AbuseRateLimitCleanupRunEntry {
  at: string;
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
  recentRuns: AbuseRateLimitCleanupRunEntry[];
}

// Bounded so the in-process buffer can never grow unbounded under any
// run cadence. At the default 1h interval, 24 entries covers the last
// day, which is enough to eyeball a sustained spam wave or a sweep
// that has regressed to trimming nothing without bloating the JSON
// payload returned to the System Health page.
const RECENT_RUNS_CAPACITY = 24;

// Surfaced to the admin System Health page so on-call can confirm the sweep
// is still running and has trimmed memory recently. The status is updated at
// the end of every `runAbuseRateLimitCleanup` call (success OR failure), so
// `lastRanAt` doubles as a heartbeat and a silent crash in the inner loop
// still flips the panel out of "Pending".
//
// Kept as an in-memory cache so the status endpoint can fall back to it if
// the persistent store (`abuse_rate_limit_cleanup_runs`) is unreachable.
// The durable store is the source of truth — it survives a server restart;
// these locals are only a hot cache populated by the current process.
let lastRanAt: Date | null = null;
let lastResult: AbuseRateLimitCleanupResult | null = null;
let lastError: { at: Date; message: string } | null = null;

// Ring buffer of the most-recent runs (oldest → newest). Pushed in the
// `finally` block of `runAbuseRateLimitCleanup` so both successful and
// failed sweeps land here, mirroring the heartbeat semantics of
// `lastRanAt`. Failed runs that never made it past SCAN show up as a
// row of zeros, which is exactly the "regression that suddenly trims
// nothing" signal the sparkline is meant to surface.
//
// Used as a fallback when the durable store is unreachable; otherwise
// `getAbuseRateLimitCleanupStatus` reads from
// `abuse_rate_limit_cleanup_runs` so the chart is populated immediately
// after an API server restart instead of waiting ~24h to re-fill.
let recentRuns: Array<{ at: Date; result: AbuseRateLimitCleanupResult }> = [];

// Baseline used to compute staleness when the job has not yet reported a
// run. Set at module load — which in production is process start, the same
// moment `startAbuseRateLimitCleanupJob` would have started running. If the
// job is supposed to be running (REDIS_URL set) but no run shows up after
// 2 intervals from this baseline, the System Health panel surfaces it as
// stale instead of leaving it on "Pending" forever.
let baselineSince: Date = new Date();

async function persistRun(
  ranAt: Date,
  result: AbuseRateLimitCleanupResult,
  errorMessage: string | null,
): Promise<void> {
  try {
    await db.insert(abuseRateLimitCleanupRunsTable).values({
      ranAt,
      scanned: result.scanned,
      trimmed: result.trimmed,
      deleted: result.deleted,
      errorMessage,
    });
    // Prune in the same write path so the table can never grow without
    // bound, even if a dedicated retention sweep is never wired up.
    const cutoff = new Date(Date.now() - PERSISTED_RUNS_RETENTION_MS);
    await db
      .delete(abuseRateLimitCleanupRunsTable)
      .where(lt(abuseRateLimitCleanupRunsTable.ranAt, cutoff));
  } catch (err) {
    // Persistence failure must never break the in-memory tracking or the
    // cleanup sweep itself — the in-memory ring buffer still serves the
    // current process. Log so the next-deploy regression is investigable.
    console.error(
      "[AbuseRateLimitCleanup] Failed to persist run to durable store:",
      (err as Error)?.message || err,
    );
  }
}

export async function runAbuseRateLimitCleanup(): Promise<AbuseRateLimitCleanupResult> {
  const stats: AbuseRateLimitCleanupResult = { scanned: 0, trimmed: 0, deleted: 0 };
  let runError: Error | null = null;
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
    runError = err instanceof Error ? err : new Error(String(err));
    lastError = {
      at: new Date(),
      message: runError.message,
    };
    throw runError;
  } finally {
    const ranAt = new Date();
    lastRanAt = ranAt;
    lastResult = stats;
    recentRuns.push({ at: ranAt, result: { ...stats } });
    if (recentRuns.length > RECENT_RUNS_CAPACITY) {
      recentRuns = recentRuns.slice(-RECENT_RUNS_CAPACITY);
    }
    // Persist *after* the in-memory cache is updated so a slow/failed DB
    // write can never delay the in-process tracking. We intentionally do
    // not await this Promise in a way that re-throws — `persistRun`
    // swallows its own errors so the cleanup sweep's success/failure is
    // determined entirely by the Redis work above.
    await persistRun(ranAt, stats, runError?.message ?? null);
  }
}

export async function getAbuseRateLimitCleanupStatus(): Promise<AbuseRateLimitCleanupStatus> {
  const enabled = Boolean(process.env.REDIS_URL);

  // Source of truth is the durable store so the System Health chart is
  // populated immediately after a server restart instead of resetting
  // to empty. We always re-fetch (rather than caching) because the
  // alerter and the System Health endpoint together poll on the order
  // of once per minute — cheap enough to read fresh.
  let durableRows: Array<{
    ranAt: Date;
    scanned: number;
    trimmed: number;
    deleted: number;
    errorMessage: string | null;
  }> = [];
  let durableReadOk = false;
  try {
    durableRows = await db
      .select({
        ranAt: abuseRateLimitCleanupRunsTable.ranAt,
        scanned: abuseRateLimitCleanupRunsTable.scanned,
        trimmed: abuseRateLimitCleanupRunsTable.trimmed,
        deleted: abuseRateLimitCleanupRunsTable.deleted,
        errorMessage: abuseRateLimitCleanupRunsTable.errorMessage,
      })
      .from(abuseRateLimitCleanupRunsTable)
      .orderBy(desc(abuseRateLimitCleanupRunsTable.ranAt))
      .limit(RECENT_RUNS_CAPACITY);
    durableReadOk = true;
  } catch (err) {
    console.error(
      "[AbuseRateLimitCleanup] Failed to read durable run history:",
      (err as Error)?.message || err,
    );
  }

  // When the durable store is reachable, derive `lastRanAt` / `lastResult`
  // / `lastError` from the most recent persisted row so they survive a
  // restart alongside the sparkline. Fall back to the in-memory cache
  // only when the read failed, which preserves the legacy behavior on
  // a DB outage.
  let resolvedLastRanAt: Date | null = lastRanAt;
  let resolvedLastResult: AbuseRateLimitCleanupResult | null = lastResult;
  let resolvedLastError: { at: Date; message: string } | null = lastError;
  let resolvedRecent: AbuseRateLimitCleanupRunEntry[] = recentRuns.map((r) => ({
    at: r.at.toISOString(),
    scanned: r.result.scanned,
    trimmed: r.result.trimmed,
    deleted: r.result.deleted,
  }));

  if (durableReadOk) {
    if (durableRows.length > 0) {
      const latest = durableRows[0];
      resolvedLastRanAt = latest.ranAt;
      resolvedLastResult = {
        scanned: latest.scanned,
        trimmed: latest.trimmed,
        deleted: latest.deleted,
      };
      // lastError mirrors the legacy semantics: it reflects whether the
      // most recent run failed (cleared by the next success), not the
      // last-ever failure. Derive that from the latest row.
      resolvedLastError = latest.errorMessage
        ? { at: latest.ranAt, message: latest.errorMessage }
        : null;
    } else {
      resolvedLastRanAt = null;
      resolvedLastResult = null;
      resolvedLastError = null;
    }
    // Reverse so the response is oldest → newest, matching the legacy
    // in-memory buffer shape that the System Health chart already expects.
    resolvedRecent = [...durableRows].reverse().map((r) => ({
      at: r.ranAt.toISOString(),
      scanned: r.scanned,
      trimmed: r.trimmed,
      deleted: r.deleted,
    }));
  }

  // When the job has never reported a run we fall back to the module-load
  // baseline: if the process has been up longer than 2 intervals without a
  // single sweep landing, that is itself a regression worth surfacing.
  const referenceTs = (resolvedLastRanAt ?? baselineSince).getTime();
  const stale = enabled && Date.now() - referenceTs > 2 * RUN_INTERVAL_MS;

  return {
    enabled,
    intervalMs: RUN_INTERVAL_MS,
    lastRanAt: resolvedLastRanAt ? resolvedLastRanAt.toISOString() : null,
    lastResult: resolvedLastResult ? { ...resolvedLastResult } : null,
    lastError: resolvedLastError
      ? { at: resolvedLastError.at.toISOString(), message: resolvedLastError.message }
      : null,
    stale,
    recentRuns: resolvedRecent,
  };
}

// Test hook: reset the in-memory status back to its initial state so each
// test can assert against a clean slate. Not intended for production use.
// Also truncates the durable run history so DB-backed assertions start
// from an empty table.
export async function __resetAbuseRateLimitCleanupStatusForTests(): Promise<void> {
  __resetInMemoryAbuseRateLimitCleanupCacheForTests();
  try {
    await db.delete(abuseRateLimitCleanupRunsTable);
  } catch (err) {
    console.error(
      "[AbuseRateLimitCleanup] Failed to truncate durable history during test reset:",
      (err as Error)?.message || err,
    );
  }
}

// Test hook: clear ONLY the in-memory cache, leaving the durable
// `abuse_rate_limit_cleanup_runs` rows intact. Used to simulate an API
// server restart and verify the System Health chart is hydrated from
// the persistent store on the next status read.
export function __resetInMemoryAbuseRateLimitCleanupCacheForTests(): void {
  lastRanAt = null;
  lastResult = null;
  lastError = null;
  recentRuns = [];
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
