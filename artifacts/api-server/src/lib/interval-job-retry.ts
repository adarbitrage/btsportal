/**
 * Shared crash-proof retry plumbing for long-interval background jobs
 * (task #2118).
 *
 * Background: production periodically has short bursts where MANY background
 * jobs fail at once with a transient Postgres error like
 * `08P01 Authentication timed out` (see
 * `.agents/memory/prod-db-auth-timeout-bursts.md`). Two problems made those
 * bursts painful:
 *
 *  1. Drizzle throws `DrizzleQueryError` whose `message` is just
 *     `Failed query: <sql>` — the real database error rides on `err.cause`,
 *     so logs were useless for diagnosis.
 *  2. Long-interval jobs (hourly/daily sweeps) silently waited their FULL
 *     interval after a transient failure instead of retrying shortly after.
 *
 * The Machine mismatch daily digest fixed both for itself (task #2117); this
 * module extracts that pattern so every long-interval job shares one
 * implementation:
 *
 *  - `describeJobError` unwraps the `cause` chain into a human-readable
 *    reason plus the underlying Postgres error code + message.
 *  - `createRetryableIntervalJob` wraps a job's run function in an interval
 *    scheduler that, after a failed attempt, retries on a short bounded
 *    backoff (default 15 min, 3 retries) instead of waiting the full
 *    interval. A fresh interval tick supersedes any pending retry, and any
 *    successful attempt clears it.
 *
 * Per-job env overrides (when an `envPrefix` is supplied):
 *   `${envPrefix}_RETRY_BACKOFF_MS` — backoff between retries (0 disables)
 *   `${envPrefix}_MAX_RETRIES`      — bounded retry count after a failure
 */

export interface DescribedJobError {
  /** Human-readable summary: top-level message plus the unwrapped cause. */
  reason: string;
  /** Underlying Postgres error code (e.g. "08P01"), when present. */
  dbErrorCode: string | null;
  /** Underlying Postgres error message, when present. */
  dbErrorMessage: string | null;
}

/**
 * Unwrap an error's `cause` chain and pull out the underlying Postgres error
 * (code + message) when present. Drizzle throws `DrizzleQueryError` whose
 * `message` is just `Failed query: <sql>` — the real database error (e.g.
 * `08P01 Authentication timed out`) rides on `err.cause`.
 */
export function describeJobError(err: unknown): DescribedJobError {
  const topMessage = err instanceof Error ? err.message : String(err);
  let dbErrorCode: string | null = null;
  let dbErrorMessage: string | null = null;
  // Walk the cause chain (bounded, defensive against cycles) looking for the
  // deepest error carrying a Postgres-style string `code`.
  let cur: unknown = err;
  for (let depth = 0; depth < 10 && cur instanceof Error; depth++) {
    const next = (cur as Error & { cause?: unknown }).cause;
    if (next instanceof Error) {
      dbErrorMessage = next.message;
      const code = (next as Error & { code?: unknown }).code;
      dbErrorCode = typeof code === "string" ? code : dbErrorCode;
      cur = next;
    } else {
      break;
    }
  }
  const reason = dbErrorMessage
    ? `${topMessage} — caused by: ${dbErrorCode ? `[${dbErrorCode}] ` : ""}${dbErrorMessage}`
    : topMessage;
  return { reason, dbErrorCode, dbErrorMessage };
}

export const DEFAULT_JOB_RETRY_BACKOFF_MS = 15 * 60 * 1000;
export const DEFAULT_JOB_MAX_RETRIES = 3;

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** How a given job attempt was initiated. */
export type JobRunTrigger = "scheduled" | "retry";

export interface RetryableIntervalJobOptions {
  /** Log prefix, e.g. "PendingEmailCleanup" → "[PendingEmailCleanup] ...". */
  label: string;
  /**
   * Env-var prefix for retry tuning (`${envPrefix}_RETRY_BACKOFF_MS`,
   * `${envPrefix}_MAX_RETRIES`). Ignored when the explicit getters below are
   * supplied.
   */
  envPrefix?: string;
  /** Run cadence in ms. Read at start(); <= 0 disables the interval. */
  getIntervalMs: () => number;
  /** Override the backoff getter entirely (e.g. legacy env names). */
  getRetryBackoffMs?: () => number;
  /** Override the max-retries getter entirely (e.g. legacy env names). */
  getMaxRetries?: () => number;
  /**
   * Run one attempt. Return `false` to signal a retryable failure the job
   * handled/recorded itself; return `true`/`undefined` on success. Throwing
   * also counts as a failure — the thrown error is logged via
   * `describeJobError` (code + message, not just the SQL text).
   */
  runAttempt: (
    trigger: JobRunTrigger,
    attempt: number,
  ) => Promise<boolean | void>;
  /** Also run an attempt immediately when start() is called. Default false. */
  runOnStart?: boolean;
}

export interface RetryableIntervalJob {
  start(): void;
  stop(): void;
  /**
   * Run one attempt now and, on failure, chain the next bounded backoff
   * retry. The interval tick and the retry timer both funnel through here.
   */
  runAttemptWithRetry(trigger: JobRunTrigger, attempt?: number): Promise<void>;
  /** Cancel any pending backoff retry (e.g. an out-of-band run succeeded). */
  clearPendingRetry(): void;
  /** Inspect the pending-retry schedule (used by status pages and tests). */
  getRetryState(): { nextRetryAt: Date | null; hasTimer: boolean };
}

export function createRetryableIntervalJob(
  opts: RetryableIntervalJobOptions,
): RetryableIntervalJob {
  const getBackoffMs =
    opts.getRetryBackoffMs ??
    (() =>
      parseEnvInt(
        `${opts.envPrefix ?? "JOB"}_RETRY_BACKOFF_MS`,
        DEFAULT_JOB_RETRY_BACKOFF_MS,
      ));
  const getMaxRetries =
    opts.getMaxRetries ??
    (() =>
      parseEnvInt(
        `${opts.envPrefix ?? "JOB"}_MAX_RETRIES`,
        DEFAULT_JOB_MAX_RETRIES,
      ));

  let jobInterval: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let nextRetryAt: Date | null = null;

  function clearPendingRetry(): void {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    nextRetryAt = null;
  }

  function scheduleRetry(attempt: number): void {
    clearPendingRetry();
    const backoffMs = getBackoffMs();
    if (backoffMs <= 0) return;
    nextRetryAt = new Date(Date.now() + backoffMs);
    console.log(
      `[${opts.label}] scheduling retry attempt ${attempt}/${getMaxRetries()} in ${Math.round(backoffMs / 1000)}s`,
    );
    retryTimer = setTimeout(() => {
      retryTimer = null;
      nextRetryAt = null;
      void runAttemptWithRetry("retry", attempt);
    }, backoffMs);
    retryTimer.unref?.();
  }

  async function runAttemptWithRetry(
    trigger: JobRunTrigger,
    attempt: number = 0,
  ): Promise<void> {
    let failed = false;
    try {
      const ok = await opts.runAttempt(trigger, attempt);
      failed = ok === false;
    } catch (err) {
      failed = true;
      const { reason, dbErrorCode } = describeJobError(err);
      console.error(
        `[${opts.label}] run failed (trigger=${trigger}, attempt=${attempt})${dbErrorCode ? ` [db ${dbErrorCode}]` : ""}: ${reason}`,
      );
    }
    if (failed) {
      if (attempt < getMaxRetries()) {
        scheduleRetry(attempt + 1);
      } else {
        console.error(
          `[${opts.label}] giving up after ${attempt} backoff retries; next attempt at the regular interval`,
        );
      }
    } else {
      // Any success proves the underlying resource is reachable again — a
      // pending backoff retry (from a previous failed run) is obsolete.
      clearPendingRetry();
    }
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      const intervalMs = opts.getIntervalMs();
      if (intervalMs > 0) {
        jobInterval = setInterval(() => {
          // A fresh interval tick supersedes any pending backoff retry.
          clearPendingRetry();
          void runAttemptWithRetry("scheduled", 0);
        }, intervalMs);
        jobInterval.unref?.();
      }
      if (opts.runOnStart) {
        void runAttemptWithRetry("scheduled", 0);
      }
    },
    stop(): void {
      if (jobInterval) {
        clearInterval(jobInterval);
        jobInterval = null;
      }
      clearPendingRetry();
      started = false;
    },
    runAttemptWithRetry,
    clearPendingRetry,
    getRetryState(): { nextRetryAt: Date | null; hasTimer: boolean } {
      return { nextRetryAt, hasTimer: retryTimer !== null };
    },
  };
}
