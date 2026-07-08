import { Router, type IRouter } from "express";
import { db, coachingCallsTable, coachesTable, coachingCallAttendanceTable } from "@workspace/db";
import { and, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";
import { ListCoachingCallsResponse, ListCoachesResponse } from "@workspace/api-zod";
import { getUserEntitlements, hasMemberAccessBypass } from "../lib/entitlements";
import { getCallUpgradeUrl } from "../lib/coaching-upgrade";
import { queueGHLSync } from "../lib/ghl-queue";

const router: IRouter = Router();

router.get("/coaching-calls", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const upcoming = req.query.upcoming === "true";
  const now = new Date();
  const [entitlements, bypass] = await Promise.all([
    getUserEntitlements(userId),
    hasMemberAccessBypass(userId),
  ]);

  let query = db
    .select({
      id: coachingCallsTable.id,
      title: coachingCallsTable.title,
      description: coachingCallsTable.description,
      callType: coachingCallsTable.callType,
      coachId: coachingCallsTable.coachId,
      coachName: coachesTable.name,
      meetLink: coachingCallsTable.meetLink,
      scheduledAt: coachingCallsTable.scheduledAt,
      durationMinutes: coachingCallsTable.durationMinutes,
      requiredEntitlement: coachingCallsTable.requiredEntitlement,
      recordingUrl: coachingCallsTable.recordingUrl,
      registeredCount: coachingCallsTable.registeredCount,
      // Soft-cancel marker. The weekly schedule needs cancelled occurrences in
      // the list (flagged) so it can render "no call this week" + roll forward
      // to the next active date, so cancelled rows are NOT filtered out here.
      cancelledAt: coachingCallsTable.cancelledAt,
      // Whether THIS member is registered for the call. The attendance row is
      // unique per (call, user) and only counts as a registration when
      // registered_at is set (a recording-only view leaves it null).
      registeredAt: coachingCallAttendanceTable.registeredAt,
    })
    .from(coachingCallsTable)
    .innerJoin(coachesTable, eq(coachingCallsTable.coachId, coachesTable.id))
    .leftJoin(
      coachingCallAttendanceTable,
      and(
        eq(coachingCallAttendanceTable.callId, coachingCallsTable.id),
        eq(coachingCallAttendanceTable.userId, userId),
      ),
    )
    .orderBy(coachingCallsTable.scheduledAt);

  // Archived coaches are hidden from the member schedule going forward: any
  // upcoming call still pointing at an archived coach is filtered out, while
  // past calls stay visible so history (and its recordings) remains intact.
  const visibleCoach = or(
    eq(coachesTable.isActive, true),
    lt(coachingCallsTable.scheduledAt, now),
  );

  const calls = upcoming
    ? await query.where(
        and(gte(coachingCallsTable.scheduledAt, now), eq(coachesTable.isActive, true)),
      )
    : await query.where(visibleCoach);

  const mapped = calls.map(({ registeredAt, cancelledAt, ...c }) => {
    const isAccessible = bypass || entitlements.has(c.requiredEntitlement);
    const cancelled = cancelledAt !== null;
    return {
      ...c,
      hasRegistered: registeredAt !== null,
      isAccessible,
      cancelled,
      // A cancelled occurrence is not joinable: never hand back a live meet
      // link for it even to an entitled member (defense-in-depth alongside the
      // 409 on the attendance POST and the disabled UI action).
      meetLink: isAccessible && !cancelled ? c.meetLink : null,
      recordingUrl: isAccessible ? c.recordingUrl : null,
      upgradeUrl: getCallUpgradeUrl(c.requiredEntitlement, isAccessible),
    };
  });

  res.json(ListCoachingCallsResponse.parse(mapped));
});

// Loads a coaching call and confirms the caller is entitled to it. Returns the
// call row, or null when the call does not exist / the member lacks the
// entitlement (both surface to the caller as a 404 so we never leak which calls
// exist to members who can't access them).
async function getAccessibleCall(
  userId: number,
  callId: number,
): Promise<{ id: number; cancelledAt: Date | null } | null> {
  if (!Number.isInteger(callId)) return null;
  const [call] = await db
    .select({
      id: coachingCallsTable.id,
      requiredEntitlement: coachingCallsTable.requiredEntitlement,
      cancelledAt: coachingCallsTable.cancelledAt,
    })
    .from(coachingCallsTable)
    .where(eq(coachingCallsTable.id, callId));
  if (!call) return null;
  const [entitlements, bypass] = await Promise.all([
    getUserEntitlements(userId),
    hasMemberAccessBypass(userId),
  ]);
  if (!bypass && !entitlements.has(call.requiredEntitlement)) return null;
  return { id: call.id, cancelledAt: call.cancelledAt };
}

// Recompute the call's registered tally directly from the attendance rows that
// currently have registered_at set, persist it on the call, and return it. This
// is the single source of truth for the count, so it stays correct across every
// transition (register, cancel, cancel -> re-register, recording-view -> register)
// instead of relying on fragile incremental +1/-1 bookkeeping that can drift.
async function syncRegisteredCount(callId: number): Promise<number> {
  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(coachingCallAttendanceTable)
    .where(
      and(
        eq(coachingCallAttendanceTable.callId, callId),
        isNotNull(coachingCallAttendanceTable.registeredAt),
      ),
    );
  const registeredCount = counted?.count ?? 0;
  await db
    .update(coachingCallsTable)
    .set({ registeredCount })
    .where(eq(coachingCallsTable.id, callId));
  return registeredCount;
}

// Record that the member registered for / is joining the live call. Stamps
// registered_at on the member's attendance row (one per call), creating it on
// first registration or re-stamping it after a prior cancel. The call's
// registered_count is then recomputed from the attendance rows so it stays
// accurate regardless of how the row was first created.
router.post("/coaching-calls/:id/attendance", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const callId = Number(req.params.id);
  const call = await getAccessibleCall(userId, callId);
  if (!call) {
    res.status(404).json({ error: "Coaching call not found" });
    return;
  }
  // A cancelled occurrence cannot be joined/registered for. 409 (not 404) so an
  // entitled member who already saw the call gets a clear "this date is off"
  // signal instead of a misleading "not found".
  if (call.cancelledAt !== null) {
    res.status(409).json({ error: "This call has been cancelled" });
    return;
  }

  const now = new Date();
  await db
    .insert(coachingCallAttendanceTable)
    .values({ callId: call.id, userId, registeredAt: now })
    .onConflictDoUpdate({
      target: [coachingCallAttendanceTable.callId, coachingCallAttendanceTable.userId],
      // Re-stamp registered_at so a member who previously cancelled (registered_at
      // cleared to null) is registered again.
      set: { registeredAt: now },
    });

  res.json({ registered: true, registeredCount: await syncRegisteredCount(call.id) });
});

// Cancel the member's registration for an upcoming call. Clears registered_at
// on the member's attendance row (the row itself is kept so a later recording
// view still attaches to it). The call's registered_count is then recomputed
// from the remaining registered attendance rows, so repeated cancels are no-ops
// and the count never drifts.
router.delete("/coaching-calls/:id/attendance", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const callId = Number(req.params.id);
  const call = await getAccessibleCall(userId, callId);
  if (!call) {
    res.status(404).json({ error: "Coaching call not found" });
    return;
  }

  await db
    .update(coachingCallAttendanceTable)
    .set({ registeredAt: null })
    .where(
      and(
        eq(coachingCallAttendanceTable.callId, call.id),
        eq(coachingCallAttendanceTable.userId, userId),
        isNotNull(coachingCallAttendanceTable.registeredAt),
      ),
    );

  res.json({ registered: false, registeredCount: await syncRegisteredCount(call.id) });
});

// Record that the member opened the call's recording. Stamps
// recording_viewed_at on the member's attendance row (creating it if the member
// never registered). Recording views never touch registered_count.
router.post("/coaching-calls/:id/recording-view", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const callId = Number(req.params.id);
  const call = await getAccessibleCall(userId, callId);
  if (!call) {
    res.status(404).json({ error: "Coaching call not found" });
    return;
  }

  const now = new Date();
  await db
    .insert(coachingCallAttendanceTable)
    .values({ callId: call.id, userId, recordingViewedAt: now })
    .onConflictDoUpdate({
      target: [coachingCallAttendanceTable.callId, coachingCallAttendanceTable.userId],
      set: { recordingViewedAt: now },
    });

  res.json({ ok: true });
});

router.get("/coaches", async (_req, res): Promise<void> => {
  // The public coaching page lists only active coaches who run group calls.
  // Private-coaching-only coaches are surfaced via the session-pack endpoints.
  const coaches = await db
    .select()
    .from(coachesTable)
    .where(
      and(
        eq(coachesTable.doesGroupCalls, true),
        eq(coachesTable.isActive, true),
      ),
    )
    .orderBy(coachesTable.sortOrder);
  // bio/specialties are nullable on the unified roster (private-only coaches and
  // not-yet-filled-in group coaches have none); coalesce so the response matches
  // the non-null string contract.
  const normalized = coaches.map((c) => ({
    ...c,
    bio: c.bio ?? "",
    specialties: c.specialties ?? "",
  }));
  res.json(ListCoachesResponse.parse(normalized));
});

export default router;
