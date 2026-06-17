/**
 * Tracks failures of the scheduled-comms dedup store (`comms_send_log`).
 *
 * Background: every scheduled email/SMS first claims a send slot via
 * `reserveSend` -> `checkAndRecordSend`. When that dedup store is broken
 * (the `comms_send_log` table is unreachable / erroring) the helper returns
 * the "error" outcome and the scheduler SKIPS the send — deliberately, so a
 * transient outage can't trigger uncontrolled double-sends every 15 minutes.
 * Task #963 made that outcome surface as a loud error log instead of silently
 * swallowing the failure, but a log line only helps if someone is watching.
 *
 * This tracker counts each "error" outcome so the failure is observable to
 * the System Health / on-call alerting layer (`comms-dedup-failure-alerter.ts`)
 * rather than living only in the logs. When the dedup store fails repeatedly
 * inside the scheduler's run window, the alerter pages on-call so a real
 * outage that's suppressing mentorship-expiry, post-call feedback, and
 * announcement emails is caught proactively.
 *
 * Storage strategy
 * ----------------
 * The scheduled-comms BullMQ worker runs with concurrency 1, so a single
 * scheduler run executes inside one process and every dedup failure in that
 * run is recorded by the same pod. A plain in-memory rolling-window event
 * log is therefore sufficient here — unlike the moderation / rate-limit
 * audit trackers, there is no fan-out across pods to aggregate. The alerter
 * (started on every pod) and the end-of-run evaluation both read this
 * in-memory snapshot on the same pod that recorded the failures, so paging
 * works regardless of which pod happens to serve the admin dashboard.
 *
 * Events are retained for up to 24h so the rolling-window query can look
 * back N minutes without a separate ring buffer, matching the retention the
 * other failure trackers use.
 */

export interface CommsDedupFailureWindowStats {
  /** Total dedup-store failures inside the window across every channel. */
  totalCount: number;
  /** Failures broken down by channel ("email" / "sms"). */
  byChannel: Record<string, number>;
  /** ISO timestamp of the most recent failure in the window, or null. */
  lastAt: string | null;
  /** Short context string from the most recent failure in the window. */
  lastContext: string | null;
  /** Window length in milliseconds the stats were computed over. */
  windowMs: number;
}

export interface CommsDedupFailureCumulativeStats {
  /** Sum of every failure recorded since process start. */
  totalCount: number;
  /** Cumulative breakdown by channel. */
  byChannel: Record<string, number>;
  /** ISO timestamp of the most recent failure, or null. */
  lastAt: string | null;
}

interface CommsDedupFailureEvent {
  at: number;
  channel: string;
  context: string;
}

// Hard cap on retained events. A dedup outage during a single scheduler run
// can record one failure per recipient (potentially hundreds), so the cap
// keeps memory bounded if the alerter somehow isn't draining the window
// (e.g. evaluation disabled in a test). 10000 covers a very large blast
// radius without unbounded growth.
const MAX_EVENTS = 10000;
// Retention ceiling — events older than this are dropped on the next access,
// matching the 24h retention the other failure trackers use.
const RETENTION_MS = 24 * 60 * 60 * 1000;

const events: CommsDedupFailureEvent[] = [];
const cumulative: Record<string, number> = {};
let cumulativeTotal = 0;
let cumulativeLastAt: number | null = null;

function pruneOlderThan(thresholdMs: number): void {
  // Events are appended in chronological order, so we only need to drop from
  // the head until the first survivor.
  while (events.length > 0 && events[0].at < thresholdMs) {
    events.shift();
  }
}

/**
 * Record a single dedup-store failure. Safe to call from the scheduler hot
 * path — pure in-memory bookkeeping. The caller (`reserveSend`) already
 * emits the loud error log line; this only updates the counters the alerter
 * and System Health read.
 */
export function recordCommsDedupFailure(channel: string, context: string): void {
  const now = Date.now();
  events.push({ at: now, channel, context });
  cumulative[channel] = (cumulative[channel] ?? 0) + 1;
  cumulativeTotal++;
  cumulativeLastAt = now;

  // Drop the oldest record if we've blown past the cap, AFTER appending so the
  // most-recent failure is always retained even at the boundary.
  if (events.length > MAX_EVENTS) {
    events.shift();
  }
  // Evict anything older than the retention ceiling so a long-quiet process
  // doesn't keep stale events around forever.
  pruneOlderThan(now - RETENTION_MS);
}

/**
 * Snapshot of the failures inside the last `windowMs` milliseconds. Used by
 * the alerter's rolling-window threshold check and by the System Health card.
 */
export function getCommsDedupFailuresInWindow(
  windowMs: number,
  now: number = Date.now(),
): CommsDedupFailureWindowStats {
  pruneOlderThan(now - RETENTION_MS);
  const cutoff = now - Math.max(0, windowMs);
  const byChannel: Record<string, number> = {};
  let totalCount = 0;
  let lastAtMs = 0;
  let lastContext: string | null = null;
  for (const ev of events) {
    if (ev.at < cutoff) continue;
    byChannel[ev.channel] = (byChannel[ev.channel] ?? 0) + 1;
    totalCount++;
    if (ev.at >= lastAtMs) {
      lastAtMs = ev.at;
      lastContext = ev.context;
    }
  }
  return {
    totalCount,
    byChannel,
    lastAt: lastAtMs ? new Date(lastAtMs).toISOString() : null,
    lastContext,
    windowMs,
  };
}

/**
 * Cumulative counters since process start. Not used for alerting (the rolling
 * window gates fire/clear) but surfaced on System Health and echoed into
 * alert bodies so on-call can tell a fresh outage apart from a sustained one.
 */
export function getCommsDedupFailureCumulativeStats(): CommsDedupFailureCumulativeStats {
  return {
    totalCount: cumulativeTotal,
    byChannel: { ...cumulative },
    lastAt: cumulativeLastAt ? new Date(cumulativeLastAt).toISOString() : null,
  };
}

/** Test-only: clear all retained events and counters. */
export function __resetCommsDedupFailureTrackerForTests(): void {
  events.length = 0;
  for (const key of Object.keys(cumulative)) delete cumulative[key];
  cumulativeTotal = 0;
  cumulativeLastAt = null;
}
