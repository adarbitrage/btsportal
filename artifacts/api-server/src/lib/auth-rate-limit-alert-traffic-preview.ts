/**
 * Traffic preview for the auth rate-limit burst alert thresholds. Powers the
 * admin Settings card so an admin can see how their saved (or in-progress)
 * threshold compares to real recent traffic — "would have fired N times in
 * the last 7 days" — instead of having to wait for a real incident to find
 * out the threshold is too high (alert effectively disabled) or too low
 * (alert would fire constantly).
 *
 * Data source: the same `auth_rate_limit_blocked` audit rows that the
 * alerter itself counts. We pull raw event timestamps over the lookback
 * window so the UI can re-simulate the alert against any draft threshold
 * without a network round trip; the per-day totals are computed in SQL so
 * they're cheap and always correct even when the raw event list is too big
 * to ship to the client.
 *
 * Cost guards:
 *   - `MAX_EVENT_TIMESTAMPS` caps the raw event payload at 10000 entries.
 *     If exceeded, the response sets `truncated: true` and omits the raw
 *     timestamps; the UI then falls back to "save and re-check" mode for
 *     the live preview but still shows the per-day totals.
 *   - The lookback window is bounded to `MAX_LOOKBACK_DAYS` so a malicious
 *     `?lookbackDays=` cannot scan years of audit history.
 */

import { db, auditLogTable } from "@workspace/db";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { AUTH_RATE_LIMIT_AUDIT_ACTION } from "../routes/auth";

/** Cap on raw event timestamps returned to the client; see file header. */
export const MAX_EVENT_TIMESTAMPS = 10000;
/** Default lookback window when the caller does not specify one. */
export const DEFAULT_LOOKBACK_DAYS = 7;
/** Hard cap so `?lookbackDays=99999` cannot scan unbounded history. */
export const MAX_LOOKBACK_DAYS = 30;
/** Floor so `?lookbackDays=0` is treated as the default. */
export const MIN_LOOKBACK_DAYS = 1;

export interface AuthRateLimitTrafficPreview {
  /** Number of full days of history considered. */
  lookbackDays: number;
  /** ISO timestamp of the start of the window (now - lookbackDays). */
  lookbackStart: string;
  /** ISO timestamp the snapshot was taken. */
  generatedAt: string;
  /** Total `auth_rate_limit_blocked` rows in the lookback window. */
  totalHits: number;
  /**
   * Per-day totals, one entry per day in the lookback window plus today's
   * partial day (so always lookbackDays+1 entries, oldest first). `dayStart`
   * is the UTC-midnight ISO timestamp of the bucket.
   */
  dailyBuckets: Array<{ dayStart: string; hits: number }>;
  /**
   * Sorted-ascending raw event timestamps (millisecond epoch) for client-side
   * window simulation. `null` when `truncated` is true.
   */
  eventTimestampsMs: number[] | null;
  /**
   * `true` when `totalHits > MAX_EVENT_TIMESTAMPS`; the client should hide
   * the live "would-have-fired" preview and show the per-day totals only.
   */
  truncated: boolean;
}

export interface SimulateInput {
  /** Sorted-ascending event timestamps, in ms. */
  eventTimestampsMs: number[];
  /** Current alert threshold (count of hits in window). */
  threshold: number;
  /** Current rolling window length, in minutes. */
  windowMinutes: number;
}

export interface SimulateResult {
  /**
   * Number of fire transitions over the timestamp series. Matches what the
   * real alerter would have done: a single sustained burst counts once, but
   * if traffic drops below threshold and rises again that is a fresh fire.
   */
  wouldHaveFiredCount: number;
  /** Maximum rolling-window hit count observed across the series. */
  peakWindowHits: number;
}

/**
 * Pure simulation of the alerter's transition logic against a series of
 * arrival timestamps. Exported so the route handler, the unit tests, and
 * (in TypeScript form) the admin UI can share the same implementation.
 *
 * Uses an event-driven sweep rather than a per-minute walk because the
 * rolling count can only RISE on event arrivals; between arrivals it can
 * only fall as old events leave the window. So checking transitions at
 * each arrival (after evicting expired entries one-by-one) catches every
 * fire transition without iterating the full minute timeline.
 */
export function simulateWouldHaveFired(input: SimulateInput): SimulateResult {
  const { eventTimestampsMs, threshold, windowMinutes } = input;
  if (
    !Array.isArray(eventTimestampsMs) ||
    eventTimestampsMs.length === 0 ||
    !Number.isFinite(threshold) ||
    threshold < 1 ||
    !Number.isFinite(windowMinutes) ||
    windowMinutes < 1
  ) {
    return { wouldHaveFiredCount: 0, peakWindowHits: 0 };
  }

  const windowMs = windowMinutes * 60 * 1000;
  // Defensive copy + sort so callers can't accidentally pass an unsorted
  // array (the production query orders by createdAt ASC, but tests and
  // future callers may not).
  const sorted = eventTimestampsMs.slice().sort((a, b) => a - b);

  // Use a head-pointer instead of Array.shift() so the inner eviction loop
  // stays O(1) per eviction — shift() is O(n) and would dominate for large
  // windows.
  let head = 0;
  let firingCount = 0;
  let isFiring = false;
  let peak = 0;

  for (let i = 0; i < sorted.length; i++) {
    const ts = sorted[i];
    // Evict events older than (ts - windowMs). The alerter uses
    // `gte(createdAt, since)` where since = now - windowMs, so an event at
    // exactly `ts - windowMs` is still inside the window.
    const cutoff = ts - windowMs;
    while (head <= i && sorted[head] < cutoff) {
      head++;
      // Between events the rolling count can only fall, never rise — so
      // the only way to transition from "firing" to "not firing" is through
      // an eviction. We have to check after each eviction so a brief lull
      // resets `isFiring` and the next burst counts as a fresh fire.
      const inWindow = i - head; // count BEFORE adding the new arrival
      if (isFiring && inWindow < threshold) {
        isFiring = false;
      }
    }
    // Now add the new arrival. `head..i` inclusive is the live window.
    const count = i - head + 1;
    if (count > peak) peak = count;
    if (!isFiring && count >= threshold) {
      isFiring = true;
      firingCount++;
    }
  }

  return { wouldHaveFiredCount: firingCount, peakWindowHits: peak };
}

/**
 * Coerce a `?lookbackDays=` query string into a valid integer in
 * [MIN_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS]. Returns DEFAULT_LOOKBACK_DAYS for
 * missing / non-numeric / out-of-range input so a bad query string never
 * 500s the endpoint.
 */
export function coerceLookbackDays(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_LOOKBACK_DAYS;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LOOKBACK_DAYS;
  const truncated = Math.trunc(n);
  if (truncated < MIN_LOOKBACK_DAYS) return MIN_LOOKBACK_DAYS;
  if (truncated > MAX_LOOKBACK_DAYS) return MAX_LOOKBACK_DAYS;
  return truncated;
}

/**
 * Normalize a `createdAt` value pulled from the audit log into a millisecond
 * epoch. Drizzle's pg driver returns `Date` objects for `timestamp` columns
 * in normal use, but the row's static type is widened to `Date | null` and
 * — depending on the connection driver — strings can also slip through.
 * Returning `null` for unparseable input lets the caller filter cleanly
 * instead of forwarding `NaN` timestamps to the client.
 */
function toEpochMs(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Read the traffic preview from the audit log. See file header for the
 * shape and trade-offs.
 */
export async function getAuthRateLimitAlertTrafficPreview(
  options: { lookbackDays?: number; now?: Date } = {},
): Promise<AuthRateLimitTrafficPreview> {
  const lookbackDays = coerceLookbackDays(options.lookbackDays);
  const now = options.now ?? new Date();
  const lookbackStart = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  // Cheap aggregate: per-day totals via date_trunc. Always returns
  // correct totals even if the raw event list is later truncated, so the
  // sparkline + headline number stay accurate at any traffic volume.
  const dayBucketExpr = sql<string>`to_char(date_trunc('day', ${auditLogTable.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
  let dailyRows: Array<{ dayStart: string; count: number }> = [];
  try {
    dailyRows = await db
      .select({
        dayStart: dayBucketExpr,
        count: sql<number>`count(*)`,
      })
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION),
          gte(auditLogTable.createdAt, lookbackStart),
        ),
      )
      .groupBy(dayBucketExpr);
  } catch (err) {
    console.error("[AuthRateLimitAlertTrafficPreview] Daily aggregate failed:", err);
    dailyRows = [];
  }

  // Build the dense daily array, oldest first, so the UI can render a
  // sparkline directly without filling in zeros itself. We always emit
  // lookbackDays+1 buckets — the trailing one is today's partial.
  const dailyMap = new Map<string, number>();
  for (const row of dailyRows) {
    dailyMap.set(row.dayStart, Number(row.count || 0));
  }
  const dailyBuckets: Array<{ dayStart: string; hits: number }> = [];
  const todayUtcMidnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  for (let i = lookbackDays; i >= 0; i--) {
    const day = new Date(todayUtcMidnight.getTime() - i * 24 * 60 * 60 * 1000);
    const key = day.toISOString().replace(/\.\d{3}Z$/, "Z");
    dailyBuckets.push({ dayStart: key, hits: dailyMap.get(key) ?? 0 });
  }

  // The total across the entire lookback window. Pulled from the daily
  // aggregate (cheap) rather than the timestamp query so the headline is
  // accurate even when the timestamp query is truncated.
  const totalHits = dailyBuckets.reduce((sum, b) => sum + b.hits, 0);

  let eventTimestampsMs: number[] | null = null;
  let truncated = false;
  if (totalHits > MAX_EVENT_TIMESTAMPS) {
    truncated = true;
  } else if (totalHits > 0) {
    try {
      const rows = await db
        .select({ createdAt: auditLogTable.createdAt })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION),
            gte(auditLogTable.createdAt, lookbackStart),
          ),
        )
        .orderBy(asc(auditLogTable.createdAt))
        .limit(MAX_EVENT_TIMESTAMPS + 1);
      if (rows.length > MAX_EVENT_TIMESTAMPS) {
        // Daily totals said we were under cap but the raw query came back
        // over — happens if a hit landed between the two queries. Be safe
        // and degrade to the truncated branch.
        truncated = true;
      } else {
        eventTimestampsMs = rows
          .map((r) => toEpochMs(r.createdAt))
          .filter((n): n is number => n !== null && Number.isFinite(n));
      }
    } catch (err) {
      console.error("[AuthRateLimitAlertTrafficPreview] Timestamp query failed:", err);
      // Don't 500: the daily totals are still useful by themselves.
      truncated = true;
    }
  } else {
    eventTimestampsMs = [];
  }

  return {
    lookbackDays,
    lookbackStart: lookbackStart.toISOString(),
    generatedAt: now.toISOString(),
    totalHits,
    dailyBuckets,
    eventTimestampsMs,
    truncated,
  };
}
