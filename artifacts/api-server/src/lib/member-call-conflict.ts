import { db, callBookingsTable } from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";
import type { FreeSlot } from "./ghl-coaching-calendar";

// Member-level booking conflict guard (Task #1723).
//
// Rule: a candidate slot is blocked if its interval [start, start +
// candidateDuration] intersects — or has a gap of less than 30 minutes from —
// any of the member's OTHER upcoming booked call intervals [scheduledAt, endAt].
// Same-day non-overlapping slots are explicitly fine; the rule is purely
// interval-adjacency, never date-based.

export const CONFLICT_BUFFER_MS = 30 * 60 * 1000; // 30 minutes

export interface UpcomingBookingInterval {
  id: number;
  scheduledAt: Date;
  endAt: Date;
  durationMinutes: number;
}

/**
 * Load all of the member's upcoming booked calls (status="booked",
 * scheduledAt >= now), optionally excluding one booking id (used in
 * reschedule flows so the call being moved doesn't block its own time window).
 */
export async function getMemberUpcomingBookings(
  memberId: number,
  excludeBookingId?: number,
): Promise<UpcomingBookingInterval[]> {
  const rows = await db
    .select({
      id: callBookingsTable.id,
      scheduledAt: callBookingsTable.scheduledAt,
      endAt: callBookingsTable.endAt,
      durationMinutes: callBookingsTable.durationMinutes,
    })
    .from(callBookingsTable)
    .where(
      and(
        eq(callBookingsTable.memberId, memberId),
        eq(callBookingsTable.status, "booked"),
        sql`${callBookingsTable.scheduledAt} >= now()`,
        excludeBookingId !== undefined ? ne(callBookingsTable.id, excludeBookingId) : undefined,
      ),
    );
  return rows;
}

/**
 * Returns true if the two intervals conflict under the 30-minute-adjacency
 * rule: blocked when the gap between them is less than 30 minutes (gap === 0
 * means they overlap).
 *
 * Uses the stored endAt for the existing booking and derives the candidate end
 * from candidateDurationMinutes (from calendar config) so we never rely on
 * hardcoded durations.
 */
export function intervalConflicts(
  candidateStartMs: number,
  candidateDurationMinutes: number,
  existingStartMs: number,
  existingDurationMinutes: number,
): boolean {
  const candidateEndMs = candidateStartMs + candidateDurationMinutes * 60_000;
  const existingEndMs = existingStartMs + existingDurationMinutes * 60_000;
  // The gap between the two intervals:
  //   gap = max(0, candidateStart - existingEnd, existingStart - candidateEnd)
  // We block if gap < CONFLICT_BUFFER_MS, i.e. if:
  //   candidateStart < existingEnd + buffer  AND  existingStart < candidateEnd + buffer
  return (
    candidateStartMs < existingEndMs + CONFLICT_BUFFER_MS &&
    existingStartMs < candidateEndMs + CONFLICT_BUFFER_MS
  );
}

/**
 * Filters a uniform-duration FreeSlot[] down to slots that don't conflict
 * with the member's other upcoming bookings.  Used for partner availability
 * (one uniform duration from the partner's calendar config).
 */
export async function filterSlotsByMemberConflict(
  memberId: number,
  candidateDurationMinutes: number,
  slots: FreeSlot[],
  excludeBookingId?: number,
): Promise<FreeSlot[]> {
  const existing = await getMemberUpcomingBookings(memberId, excludeBookingId);
  if (existing.length === 0) return slots;
  return slots.filter((s) => {
    const startMs = new Date(s.startTime).getTime();
    return !existing.some((b) =>
      intervalConflicts(startMs, candidateDurationMinutes, b.scheduledAt.getTime(), b.durationMinutes),
    );
  });
}

/**
 * Returns true if a candidate booking (start + duration from calendar config)
 * conflicts with any of the member's other upcoming booked calls.  Used as
 * the server-side gate in the four write paths.
 */
export async function memberBookingConflicts(
  memberId: number,
  candidateStartMs: number,
  candidateDurationMinutes: number,
  excludeBookingId?: number,
): Promise<boolean> {
  const existing = await getMemberUpcomingBookings(memberId, excludeBookingId);
  return existing.some((b) =>
    intervalConflicts(candidateStartMs, candidateDurationMinutes, b.scheduledAt.getTime(), b.durationMinutes),
  );
}
