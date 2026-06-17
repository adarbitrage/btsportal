import { Router, type IRouter } from "express";
import { db, coachingCallsTable, coachesTable, coachingCallAttendanceTable } from "@workspace/db";
import { eq, gte, sql } from "drizzle-orm";
import { ListCoachingCallsResponse, ListCoachesResponse } from "@workspace/api-zod";
import { getUserEntitlements } from "../lib/entitlements";
import { getCallUpgradeUrl } from "../lib/coaching-upgrade";
import { queueGHLSync } from "../lib/ghl-queue";

const router: IRouter = Router();

router.get("/coaching-calls", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const upcoming = req.query.upcoming === "true";
  const now = new Date();
  const entitlements = await getUserEntitlements(userId);

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
    })
    .from(coachingCallsTable)
    .innerJoin(coachesTable, eq(coachingCallsTable.coachId, coachesTable.id))
    .orderBy(coachingCallsTable.scheduledAt);

  const calls = upcoming
    ? await query.where(gte(coachingCallsTable.scheduledAt, now))
    : await query;

  const mapped = calls.map((c) => {
    const isAccessible = entitlements.has(c.requiredEntitlement);
    return {
      ...c,
      isAccessible,
      meetLink: isAccessible ? c.meetLink : null,
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
): Promise<{ id: number } | null> {
  if (!Number.isInteger(callId)) return null;
  const [call] = await db
    .select({
      id: coachingCallsTable.id,
      requiredEntitlement: coachingCallsTable.requiredEntitlement,
    })
    .from(coachingCallsTable)
    .where(eq(coachingCallsTable.id, callId));
  if (!call) return null;
  const entitlements = await getUserEntitlements(userId);
  if (!entitlements.has(call.requiredEntitlement)) return null;
  return { id: call.id };
}

// Record that the member registered for / is joining the live call. Stamps
// registered_at on the member's attendance row (one per call), creating it on
// first registration. registered_count on the call is the running tally of
// distinct registrants and is only bumped when a brand-new row is inserted.
router.post("/coaching-calls/:id/attendance", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const callId = Number(req.params.id);
  const call = await getAccessibleCall(userId, callId);
  if (!call) {
    res.status(404).json({ error: "Coaching call not found" });
    return;
  }

  const now = new Date();
  const inserted = await db
    .insert(coachingCallAttendanceTable)
    .values({ callId: call.id, userId, registeredAt: now })
    .onConflictDoUpdate({
      target: [coachingCallAttendanceTable.callId, coachingCallAttendanceTable.userId],
      // Keep the first registration timestamp once set; only fill it in if the
      // row was created earlier by a recording view.
      set: { registeredAt: sql`coalesce(${coachingCallAttendanceTable.registeredAt}, ${now})` },
    })
    .returning({
      id: coachingCallAttendanceTable.id,
      registeredAt: coachingCallAttendanceTable.registeredAt,
      createdAt: coachingCallAttendanceTable.createdAt,
    });

  // A genuinely new registration is one whose row was created by this insert
  // (created_at === registered_at). Only then do we bump the call's tally.
  const row = inserted[0];
  const isNewRegistration =
    !!row &&
    !!row.registeredAt &&
    !!row.createdAt &&
    row.registeredAt.getTime() === row.createdAt.getTime();
  if (isNewRegistration) {
    await db
      .update(coachingCallsTable)
      .set({ registeredCount: sql`${coachingCallsTable.registeredCount} + 1` })
      .where(eq(coachingCallsTable.id, call.id));
  }

  res.json({ ok: true });
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
  const coaches = await db.select().from(coachesTable);
  res.json(ListCoachesResponse.parse(coaches));
});

export default router;
