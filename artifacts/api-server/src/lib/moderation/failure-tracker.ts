/**
 * Tracks failures of the background moderation queue (`enqueueModerationJob`).
 *
 * Two distinct failure kinds matter to on-call:
 *   - `engine` — the AI/wordlist evaluator threw. The post is now public and
 *     was never inspected: a flag-worthy post may have slipped through.
 *   - `persist` — the evaluator flagged the content but the DB update that
 *     would set status=shadow_hidden or insert into the moderation queue
 *     threw. The content is *known to be flag-worthy* and still publicly
 *     `active`. This is the more serious of the two.
 *
 * Each kind is tracked independently so the alert body can call out which
 * pathway is failing (a database flap vs. an OpenAI / classifier outage).
 *
 * Storage is in-memory per process. The moderation queue itself is
 * in-process (`setImmediate`-driven), so cluster-wide aggregation would
 * not be more meaningful than the local view — each pod only ever knows
 * about its own queue's failures. Timestamps are retained for up to 24h
 * so the alerter's rolling-window check can look back N minutes without
 * having to maintain a separate ring buffer.
 */

export type ModerationFailureKind = "engine" | "persist";

export interface ModerationFailureEvent {
  kind: ModerationFailureKind;
  /** Wall-clock time when the failure was recorded. */
  at: number;
  /** Short, human-readable description of the error. */
  message: string;
  /** "post" or "comment" — surfaced in the alert body. */
  targetType: "post" | "comment";
  /** The DB id of the target so on-call can grep audit logs. */
  targetId: number;
}

export interface ModerationFailureWindowStats {
  /** Total failures in the window across both kinds. */
  totalCount: number;
  /** Failures broken down by kind. */
  byKind: Record<ModerationFailureKind, number>;
  /** ISO timestamp of the most recent failure in the window, or null. */
  lastAt: string | null;
  /** Short error string from the most recent failure in the window. */
  lastError: string | null;
  /** Kind of the most recent failure in the window. */
  lastKind: ModerationFailureKind | null;
  /** Window length in milliseconds the stats were computed over. */
  windowMs: number;
}

export interface ModerationFailureCumulativeStats {
  /** Sum of every failure recorded since process start. */
  totalCount: number;
  /** Cumulative breakdown by kind. */
  byKind: Record<ModerationFailureKind, number>;
  /** ISO timestamp of the most recent failure, or null. */
  lastAt: string | null;
}

// Hard cap on retained events. Failures large enough to hit this cap would
// already have paged on-call; the cap exists to keep memory bounded if the
// alerter is somehow not draining the buffer (e.g. evaluation disabled in a
// test). 5000 covers ~3.5 failures/sec for 24h, far beyond what a real
// outage produces before someone responds.
const MAX_EVENTS = 5000;
// Hard retention ceiling — any event older than this is dropped on the next
// access, matching the 24h TTL the rate-limit tracker uses for its Redis
// snapshot. Keeps the rolling-window query bounded.
const RETENTION_MS = 24 * 60 * 60 * 1000;

const events: ModerationFailureEvent[] = [];
const cumulative: Record<ModerationFailureKind, number> = {
  engine: 0,
  persist: 0,
};
let cumulativeLastAt: number | null = null;

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const maybe = (err as { message?: unknown }).message;
    if (typeof maybe === "string") return maybe;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function pruneOlderThan(thresholdMs: number): void {
  // Events are appended in chronological order, so we only need to drop
  // from the head until the first survivor.
  while (events.length > 0 && events[0].at < thresholdMs) {
    events.shift();
  }
}

/**
 * Record a single failure and emit a structured warning line. Safe to
 * call from any hot path — pure in-memory bookkeeping plus a `console.warn`.
 *
 * The `[Moderation][Failure]` prefix is distinct from the existing
 * `[Moderation]` log lines in `queue.ts` so log-based alerting can count
 * this signal independently from generic moderation logs.
 */
export function recordModerationFailure(
  kind: ModerationFailureKind,
  err: unknown,
  context: { targetType: "post" | "comment"; targetId: number },
): void {
  const now = Date.now();
  const message = describeError(err);
  events.push({
    kind,
    at: now,
    message,
    targetType: context.targetType,
    targetId: context.targetId,
  });
  cumulative[kind]++;
  cumulativeLastAt = now;

  // Drop the oldest record if we've blown past the cap. We do this AFTER
  // appending so the most-recent failure is always retained even at the
  // boundary.
  if (events.length > MAX_EVENTS) {
    events.shift();
  }
  // Also evict anything older than the retention ceiling so a long-quiet
  // process doesn't keep stale events around forever.
  pruneOlderThan(now - RETENTION_MS);

  console.warn(
    `[Moderation][Failure] kind=${kind} ${context.targetType}=${context.targetId} error=${message} at=${new Date(now).toISOString()}`,
  );
}

/**
 * Snapshot of the failures inside the last `windowMs` milliseconds. Used
 * by the alerter to evaluate a rolling-window threshold, and by the
 * System Health endpoint to render the same number the alerter sees.
 */
export function getModerationFailuresInWindow(
  windowMs: number,
  now: number = Date.now(),
): ModerationFailureWindowStats {
  const cutoff = now - Math.max(0, windowMs);
  // Prune lazily on read so a process that has stopped failing eventually
  // drops its retained events without needing a background sweeper.
  pruneOlderThan(now - RETENTION_MS);
  const byKind: Record<ModerationFailureKind, number> = { engine: 0, persist: 0 };
  let lastAtMs = 0;
  let lastError: string | null = null;
  let lastKind: ModerationFailureKind | null = null;
  for (const ev of events) {
    if (ev.at < cutoff) continue;
    byKind[ev.kind]++;
    if (ev.at >= lastAtMs) {
      lastAtMs = ev.at;
      lastError = ev.message;
      lastKind = ev.kind;
    }
  }
  const totalCount = byKind.engine + byKind.persist;
  return {
    totalCount,
    byKind,
    lastAt: lastAtMs ? new Date(lastAtMs).toISOString() : null,
    lastError,
    lastKind,
    windowMs,
  };
}

/**
 * Cumulative counters since process start. Not used for alerting (the
 * rolling window is what gates fire/clear) but surfaced on System Health
 * as a "lifetime" view and echoed into alert bodies so on-call can tell
 * a fresh outage apart from a sustained one.
 */
export function getModerationFailureCumulativeStats(): ModerationFailureCumulativeStats {
  return {
    totalCount: cumulative.engine + cumulative.persist,
    byKind: { ...cumulative },
    lastAt: cumulativeLastAt ? new Date(cumulativeLastAt).toISOString() : null,
  };
}

/** Test-only: clear all retained events and counters. */
export function __resetModerationFailureTrackerForTests(): void {
  events.length = 0;
  cumulative.engine = 0;
  cumulative.persist = 0;
  cumulativeLastAt = null;
}
