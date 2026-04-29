/**
 * Tracks whenever the email/SMS queue is unavailable and the communication
 * service has to fall back to a direct send. Operators need a clear signal
 * when this happens so a Redis outage doesn't go unnoticed for hours.
 *
 * Responsibilities:
 *   - Persist every fallback as an `auditLogTable` row (action_type
 *     `queue_fallback`) so the 24-hour history survives an api-server
 *     restart and works correctly across multiple instances.
 *   - Keep an in-memory ring of recent fallback timestamps per channel for
 *     fast alert throttling — we don't want to hit the DB on every send to
 *     decide whether to print an `[ALERT]` line.
 *   - Emit a single throttled `[Comms][ALERT]` warning per N minutes when
 *     fallbacks happen in quick succession, so the log isn't spammed but
 *     on-call can still grep for the alert string.
 *   - Expose stats for the health endpoint and admin UI to surface, sourced
 *     from the database so they reflect the durable record.
 */

import { db, auditLogTable } from "@workspace/db";
import { and, eq, gte } from "drizzle-orm";

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

export const QUEUE_FALLBACK_ACTION_TYPE = "queue_fallback";
export const QUEUE_FALLBACK_ENTITY_TYPE = "queue";

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
 * Persist a fallback event to `auditLogTable` so the history survives
 * restarts. Fire-and-forget on the caller side; we swallow errors here so
 * a transient DB hiccup never fails the user-facing send path.
 */
async function persistFallback(
  channel: QueueChannel,
  occurredAt: Date,
  opts: RecordFallbackOptions,
): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      actionType: QUEUE_FALLBACK_ACTION_TYPE,
      entityType: QUEUE_FALLBACK_ENTITY_TYPE,
      entityId: channel,
      description: `Queue fallback fired for ${channel} channel${opts.reason ? ` (${opts.reason})` : ""}`,
      metadata: {
        channel,
        recipient: opts.recipient ?? null,
        reason: opts.reason ?? null,
        occurredAt: occurredAt.toISOString(),
      },
      createdAt: occurredAt,
    });
  } catch (error) {
    console.error("[Comms][Fallback] Failed to persist queue-fallback audit row:", error);
  }
}

/**
 * Listener invoked after each fallback event is recorded. Used by the
 * queue-fallback-alerter to dispatch external notifications (PagerDuty,
 * email, Slack) without making the tracker itself depend on those
 * subsystems. Listener errors are caught so they can never mask the core
 * recording behavior.
 */
export type QueueFallbackListener = (
  channel: QueueChannel,
  opts: RecordFallbackOptions,
) => void;

let listener: QueueFallbackListener | null = null;

export function setQueueFallbackListener(
  fn: QueueFallbackListener | null,
): void {
  listener = fn;
}

/**
 * Record a fallback event for the given channel. Always emits a structured
 * log line (`[Comms][Fallback] channel=...`) so external log aggregators can
 * count occurrences. Persists the event to the database so the 24h history
 * survives api-server restarts. Emits a throttled `[Comms][ALERT]` warning
 * when the recent fallback count crosses the alert threshold and we haven't
 * alerted for this channel in the last throttle window.
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

  // Fire-and-forget: durability of the audit row must never block the send
  // path. Errors are logged inside persistFallback().
  void persistFallback(channel, new Date(now), opts);

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

  if (listener) {
    try {
      listener(channel, opts);
    } catch (err) {
      // A misbehaving listener must never prevent us from recording the
      // fallback or returning to the caller. Log and move on.
      console.error("[QueueFallbackTracker] listener error:", err);
    }
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

function emptyStats(): ChannelStats {
  return { recentCount: 0, hourCount: 0, dayCount: 0, lastAt: null };
}

function bucketEventsIntoStats(timestamps: number[], now: number): ChannelStats {
  const stats = emptyStats();
  let lastAt = 0;
  const recentCutoff = now - RECENT_WINDOW_MS;
  const hourCutoff = now - 60 * 60 * 1000;
  const dayCutoff = now - RETENTION_MS;
  for (const ts of timestamps) {
    if (ts < dayCutoff) continue;
    stats.dayCount++;
    if (ts >= hourCutoff) stats.hourCount++;
    if (ts >= recentCutoff) stats.recentCount++;
    if (ts > lastAt) lastAt = ts;
  }
  stats.lastAt = lastAt ? new Date(lastAt).toISOString() : null;
  return stats;
}

function channelStatsInMemory(ch: ChannelState, now: number): ChannelStats {
  pruneOlderThan(ch.events, now - RETENTION_MS);
  return bucketEventsIntoStats(ch.events, now);
}

/**
 * Synchronous, in-memory snapshot of fallback stats. Kept for backwards
 * compatibility (and used as a fallback when the database is unreachable).
 * New callers that can `await` should prefer `getQueueFallbackStatsFromDb`,
 * which gives durable counts that survive restarts.
 */
export function getQueueFallbackStats(): QueueFallbackStats {
  const now = Date.now();
  const email = channelStatsInMemory(state.email, now);
  const sms = channelStatsInMemory(state.sms, now);
  return {
    email,
    sms,
    alerting: email.recentCount > 0 || sms.recentCount > 0,
    recentWindowMs: RECENT_WINDOW_MS,
  };
}

/**
 * Read fallback stats from `auditLogTable`. This is the source of truth that
 * operators see in the admin UI — it survives api-server restarts and works
 * correctly when more than one api-server instance is recording fallbacks.
 *
 * If the DB query fails for any reason, falls back to the in-memory stats so
 * the health endpoint never blows up just because the audit table is having
 * a bad day.
 */
export async function getQueueFallbackStatsFromDb(): Promise<QueueFallbackStats> {
  const now = Date.now();
  try {
    const rows = await db
      .select({
        entityId: auditLogTable.entityId,
        createdAt: auditLogTable.createdAt,
      })
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, QUEUE_FALLBACK_ACTION_TYPE),
          eq(auditLogTable.entityType, QUEUE_FALLBACK_ENTITY_TYPE),
          gte(auditLogTable.createdAt, new Date(now - RETENTION_MS)),
        ),
      );

    const buckets: Record<QueueChannel, number[]> = { email: [], sms: [] };
    for (const row of rows) {
      const channel = row.entityId === "sms" ? "sms" : row.entityId === "email" ? "email" : null;
      if (!channel) continue;
      const ts = row.createdAt instanceof Date ? row.createdAt.getTime() : new Date(row.createdAt).getTime();
      if (Number.isNaN(ts)) continue;
      buckets[channel].push(ts);
    }

    const email = bucketEventsIntoStats(buckets.email, now);
    const sms = bucketEventsIntoStats(buckets.sms, now);
    return {
      email,
      sms,
      alerting: email.recentCount > 0 || sms.recentCount > 0,
      recentWindowMs: RECENT_WINDOW_MS,
    };
  } catch (error) {
    console.error("[Comms][Fallback] Failed to read queue-fallback stats from DB, falling back to in-memory:", error);
    return getQueueFallbackStats();
  }
}

/** Test-only helper to reset internal counters between tests. */
export function __resetQueueFallbackTrackerForTests(): void {
  state.email.events = [];
  state.email.lastAlertAt = 0;
  state.sms.events = [];
  state.sms.lastAlertAt = 0;
  listener = null;
}
