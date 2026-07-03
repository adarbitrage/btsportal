/**
 * Shared no-show / days-since-last-call computations for accountability
 * partners (Task #1592 partner dashboard + Task #1629 escalation alerts).
 *
 * Both the partner dashboard (`routes/partner-dashboard.ts`) and the
 * escalation evaluator (`lib/partner-escalation-alerter.ts`) need the exact
 * same "how many consecutive no-shows does this member have right now" and
 * "how many days since their last completed call" logic — the alerter's
 * no-show escalation (3rd consecutive no-show) and vanish rule (14 days
 * since last completed call) must agree with what the dashboard displays, or
 * a partner could see "2 consecutive no-shows" on their roster while
 * on-call gets paged for a 3rd. Extracted here so there is exactly one
 * implementation, imported by both call sites — no behavior change from the
 * original dashboard-only versions.
 */

/**
 * Days since `date`, floored, clamped to >= 0. Null input -> null.
 *
 * `now` (epoch ms, defaults to the current clock) is threaded through by
 * callers that evaluate time-boundary rules — e.g. the vanish rule's 14-day
 * threshold — so a whole evaluation pass computes against ONE consistent
 * instant (no mid-pass clock drift across midnight) and tests can pin exact
 * boundary behavior (day 13.99 vs 14.01) deterministically.
 */
export function daysSince(
  date: Date | string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!date) return null;
  const ms = now - new Date(date).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Given completed/no_show rows for one or more members, ordered
 * member_id, scheduled_at DESC (most recent first per member), count how
 * many of the most-recent-first rows are consecutive `no_show` before
 * hitting a `completed` (or running out of rows).
 *
 * A member with no rows at all, or whose most recent row is `completed`,
 * simply does not appear in the returned map (implicit count of 0).
 */
export function computeConsecutiveNoShows(
  rows: Array<{ member_id: number; status: string }>,
): Map<number, number> {
  const result = new Map<number, number>();
  const stopped = new Set<number>();
  for (const row of rows) {
    if (stopped.has(row.member_id)) continue;
    if (row.status === "no_show") {
      result.set(row.member_id, (result.get(row.member_id) ?? 0) + 1);
    } else {
      stopped.add(row.member_id);
    }
  }
  return result;
}
