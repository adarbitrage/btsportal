import { db, callBookingsTable } from "@workspace/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { completeOnboardingAfterPartnerCallDone } from "./onboarding-advancement";

// Shared "mark a partner call done" path (Task #1592). This is the ONLY
// legitimate way a `call_bookings` row of type "partner" moves from "booked"
// to "completed" — used today by the partner dashboard's manual
// mark-call-done action, and intended for the future T7 GHL webhook that
// confirms partner calls actually happened. Both callers MUST go through
// this single function so the flip + first-call onboarding advancement can
// never drift between the two paths.
//
// No-op-safe: if the booking doesn't exist, isn't a partner call, or isn't
// currently "booked", nothing changes and `updated` is false. This makes it
// safe to call from a webhook that might retry/replay.
export interface MarkPartnerCallDoneResult {
  /** Whether the booking row was flipped booked -> completed by this call. */
  updated: boolean;
  /** Whether this call also advanced the member's onboarding (first ever
   *  completed partner call for them). */
  onboardingAdvanced: boolean;
}

export async function markPartnerCallDone(
  bookingId: number,
): Promise<MarkPartnerCallDoneResult> {
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select({
        id: callBookingsTable.id,
        memberId: callBookingsTable.memberId,
        type: callBookingsTable.type,
        status: callBookingsTable.status,
      })
      .from(callBookingsTable)
      .where(eq(callBookingsTable.id, bookingId))
      .limit(1);

    if (!booking || booking.type !== "partner" || booking.status !== "booked") {
      return { updated: false, onboardingAdvanced: false };
    }

    // Count prior completed partner calls for this member BEFORE flipping
    // this one, so "first call" detection is unambiguous regardless of call
    // order/retries.
    const [{ value: priorCompletedCount }] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(callBookingsTable)
      .where(
        and(
          eq(callBookingsTable.memberId, booking.memberId),
          eq(callBookingsTable.type, "partner"),
          eq(callBookingsTable.status, "completed"),
          lt(callBookingsTable.id, booking.id),
        ),
      );

    const updated = await tx
      .update(callBookingsTable)
      .set({ status: "completed" })
      .where(and(eq(callBookingsTable.id, bookingId), eq(callBookingsTable.status, "booked")))
      .returning({ id: callBookingsTable.id });

    if (updated.length === 0) {
      return { updated: false, onboardingAdvanced: false };
    }

    let onboardingAdvanced = false;
    if (priorCompletedCount === 0) {
      onboardingAdvanced = await completeOnboardingAfterPartnerCallDone(booking.memberId);
    }

    return { updated: true, onboardingAdvanced };
  });
}
