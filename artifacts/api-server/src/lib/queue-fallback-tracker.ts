/**
 * Tracks whenever the email/SMS queue is unavailable and the communication
 * service has to fall back to a direct send. Operators need a clear signal
 * when this happens so a Redis outage doesn't go unnoticed for hours.
 *
 * Responsibilities:
 *   - Keep an in-memory ring of recent fallback timestamps per channel so we
 *     can answer "how many fallbacks in the last 5m / 1h / 24h?" without
 *     hitting the database.
 *   - Emit a single throttled `[Comms][ALERT]` warning per N minutes when
 *     fallbacks happen in quick succession, so the log isn't spammed but
 *     on-call can still grep for the alert string.
 *   - Expose stats for the health endpoint and admin UI to surface.
 *
 * This is intentionally process-local — each api-server instance tracks its
 * own counters. That's fine for the current single-process deployment, and
 * the structured log lines are what an external aggregator (e.g. log search)
 * would key off of in a multi-instance setup.
 */

export type QueueChannel = "email" | "sms";

const RETENTION_MS = 24 * 60 * 60 * 1000; // 24h
const RECENT_WINDOW_MS = Number.parseInt(
  process.env.QUEUE_FALLBACK_RECENT_WINDOW_MS || String(5 * 60 * 1000),
  10,
);
const ALERT_THROTTLE_MS = Number.parseInt(
  process.env.QUEUE_FALLBACK_ALERT_THROTTLE_MS || String(5 * 60 * 1000),
  10,
);
const ALERT_THRESHOLD = Number.parseInt(
  process.env.QUEUE_FALLBACK_ALERT_THRESHOLD || "1",
  10,
);

interface ChannelState {
  events: number[]; // unix ms timestamps, ascending
  lastAlertAt: number;
}

const state: Record<QueueChannel, ChannelState> = {
  email: { events: [], lastAlertAt: 0 },
  sms: { events: [], lastAlertAt: 0 },
};

function pruneOlderThan(events: number[], cutoff: number): void {
  // events are ascending; drop the prefix that's older than cutoff.
  let i = 0;
  while (i < events.length && events[i] < cutoff) i++;
  if (i > 0) events.splice(0, i);
}

function countWithin(events: number[], windowMs: number, now: number): number {
  const cutoff = now - windowMs;
  let count = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i] >= cutoff) count++;
    else break;
  }
  return count;
}

export interface RecordFallbackOptions {
  /** Optional recipient (email or phone) for the structured log line. Never logged in plain form for privacy if desired by future redaction layer. */
  recipient?: string;
  /** Optional reason describing why the queue was unavailable (e.g. "redis_not_ready"). */
  reason?: string;
}

/**
 * Record a fallback event for the given channel. Always emits a structured
 * log line (`[Comms][Fallback] channel=...`) so external log aggregators can
 * count occurrences. Emits a throttled `[Comms][ALERT]` warning when the
 * recent fallback count crosses the alert threshold and we haven't alerted
 * for this channel in the last throttle window.
 */
export function recordQueueFallback(
  channel: QueueChannel,
  opts: RecordFallbackOptions = {},
): void {
  const now = Date.now();
  const ch = state[channel];
  ch.events.push(now);
  pruneOlderThan(ch.events, now - RETENTION_MS);

  const recipient = opts.recipient ? ` recipient=${opts.recipient}` : "";
  const reason = opts.reason ? ` reason=${opts.reason}` : "";
  // Structured one-line log so log search can count fallbacks.
  console.log(
    `[Comms][Fallback] channel=${channel}${recipient}${reason} at=${new Date(now).toISOString()}`,
  );

  const recentCount = countWithin(ch.events, RECENT_WINDOW_MS, now);
  const sinceLastAlert = now - ch.lastAlertAt;
  if (recentCount >= ALERT_THRESHOLD && sinceLastAlert >= ALERT_THROTTLE_MS) {
    ch.lastAlertAt = now;
    console.warn(
      `[Comms][ALERT] ${channel} queue unavailable — direct-send fallback fired ${recentCount}x in the last ${Math.round(
        RECENT_WINDOW_MS / 60000,
      )}m. Check Redis health.`,
    );
  }
}

export interface ChannelStats {
  /** Count of fallbacks in the last "recent" window (default 5 min). */
  recentCount: number;
  /** Count in the last 1 hour. */
  hourCount: number;
  /** Count in the last 24 hours. */
  dayCount: number;
  /** ISO timestamp of the most recent fallback, or null if never. */
  lastAt: string | null;
}

export interface QueueFallbackStats {
  email: ChannelStats;
  sms: ChannelStats;
  /** True if any channel had a fallback in the recent window. */
  alerting: boolean;
  /** Window size used for `recentCount` and `alerting`, in milliseconds. */
  recentWindowMs: number;
}

function channelStats(ch: ChannelState, now: number): ChannelStats {
  pruneOlderThan(ch.events, now - RETENTION_MS);
  const last = ch.events.length ? ch.events[ch.events.length - 1] : 0;
  return {
    recentCount: countWithin(ch.events, RECENT_WINDOW_MS, now),
    hourCount: countWithin(ch.events, 60 * 60 * 1000, now),
    dayCount: ch.events.length,
    lastAt: last ? new Date(last).toISOString() : null,
  };
}

export function getQueueFallbackStats(): QueueFallbackStats {
  const now = Date.now();
  const email = channelStats(state.email, now);
  const sms = channelStats(state.sms, now);
  return {
    email,
    sms,
    alerting: email.recentCount > 0 || sms.recentCount > 0,
    recentWindowMs: RECENT_WINDOW_MS,
  };
}

/** Test-only helper to reset internal counters between tests. */
export function __resetQueueFallbackTrackerForTests(): void {
  state.email.events = [];
  state.email.lastAlertAt = 0;
  state.sms.events = [];
  state.sms.lastAlertAt = 0;
}
