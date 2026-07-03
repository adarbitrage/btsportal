import { db, callBookingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

// Shared "mark a partner call done" path (Task #1592). This is the ONLY
// legitimate way a `call_bookings` row of type "partner" moves from "booked"
// to "completed" — used by the partner dashboard's manual mark-call-done
// action and the GHL "appointment completed" webhook (webhooks-ghl.ts). Both
// callers MUST go through this single function so the status flip can never
// drift between the two paths.
//
// No-op-safe: if the booking doesn't exist, isn't a partner call, or isn't
// currently "booked", nothing changes and `updated` is false. This makes it
// safe to call from a webhook that might retry/replay.
//
// Task #1666: this function no longer touches onboarding at all. A first
// partner call being marked "completed" used to complete the member's
// onboarding (see the now-removed completeOnboardingAfterPartnerCallDone);
// onboarding completion is now exclusively a member-driven action on the
// `send_off` step (PATCH /members/me/onboarding), for BOTH variants. The
// `onboardingAdvanced` field is kept (always `false`) purely so existing
// callers/response shapes don't need to change.
export interface MarkPartnerCallDoneResult {
  /** Whether the booking row was flipped booked -> completed by this call. */
  updated: boolean;
  /** @deprecated Always `false` since Task #1666 — onboarding completion no
   *  longer happens as a side effect of a call being marked done. Kept for
   *  response-shape compatibility with existing callers. */
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

    const updated = await tx
      .update(callBookingsTable)
      .set({ status: "completed" })
      .where(and(eq(callBookingsTable.id, bookingId), eq(callBookingsTable.status, "booked")))
      .returning({ id: callBookingsTable.id });

    if (updated.length === 0) {
      return { updated: false, onboardingAdvanced: false };
    }

    return { updated: true, onboardingAdvanced: false };
  });
}
