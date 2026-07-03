import { db, callBookingsTable } from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { COACHING_TIMEZONE, type FreeSlot } from "./ghl-coaching-calendar";

// Shared cap-aware slot filtering for accountability-partner calls. Extracted
// (Task #1654) so both the member-facing availability/booking endpoints
// (call-bookings.ts) and the assignment-time soonest-slot probe
// (partner-assignment.ts) enforce the SAME 5-6/day (`maxDailyCalls`) cap the
// same way — raw GHL free slots have no concept of the portal-side cap, only
// the portal's own `call_bookings` rows do.

export const MIN_LEAD_TIME_MS = 60 * 60 * 1000; // 1 hour

// Calendar-day key in the coaching timezone (YYYY-MM-DD), used to group slots
// and count bookings per partner-day for the daily cap.
export function dayKeyInTz(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: COACHING_TIMEZONE });
}

// Non-canceled partner-call counts per day (coaching-timezone date key) for
// this partner, used to enforce the maxDailyCalls cap.
export async function getPartnerDailyCounts(
  partnerId: number,
  startMs: number,
  endMs: number,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ scheduledAt: callBookingsTable.scheduledAt })
    .from(callBookingsTable)
    .where(
      and(
        eq(callBookingsTable.staffId, partnerId),
        eq(callBookingsTable.staffType, "partner"),
        eq(callBookingsTable.type, "partner"),
        ne(callBookingsTable.status, "canceled"),
        sql`${callBookingsTable.scheduledAt} >= to_timestamp(${startMs / 1000})`,
        sql`${callBookingsTable.scheduledAt} <= to_timestamp(${endMs / 1000})`,
      ),
    );
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = dayKeyInTz(row.scheduledAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Filters raw GHL free slots down to ones that are (a) past the 1-hour lead
 * time and (b) on a day that hasn't already hit the partner's `maxDailyCalls`
 * cap. Does NOT apply the member-specific "first call can't be before
 * kickoff" cutoff — that's layered on separately in call-bookings.ts, since
 * it only applies to a specific member's booking flow, not the
 * assignment-time soonest-slot probe (which runs before any member-specific
 * booking context exists).
 */
export async function filterSlotsByDailyCap(
  partnerId: number,
  maxDailyCalls: number,
  slots: FreeSlot[],
  startMs: number,
  endMs: number,
): Promise<FreeSlot[]> {
  const dailyCounts = await getPartnerDailyCounts(partnerId, startMs, endMs);
  const leadCutoffMs = Date.now() + MIN_LEAD_TIME_MS;

  return slots.filter((s) => {
    const start = new Date(s.startTime);
    const startMsSlot = start.getTime();
    if (startMsSlot < leadCutoffMs) return false;
    const dayKey = dayKeyInTz(start);
    const countForDay = dailyCounts.get(dayKey) ?? 0;
    if (countForDay >= maxDailyCalls) return false;
    return true;
  });
}
