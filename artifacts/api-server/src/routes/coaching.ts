import { Router, type IRouter } from "express";
import { db, coachingCallsTable, coachesTable } from "@workspace/db";
import { eq, gte } from "drizzle-orm";
import { ListCoachingCallsResponse, ListCoachesResponse } from "@workspace/api-zod";
import { getUserEntitlements } from "../lib/entitlements";

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

  const mapped = calls.map((c) => ({
    ...c,
    isAccessible: entitlements.has(c.requiredEntitlement),
  }));

  res.json(ListCoachingCallsResponse.parse(mapped));
});

router.get("/coaches", async (_req, res): Promise<void> => {
  const coaches = await db.select().from(coachesTable);
  res.json(ListCoachesResponse.parse(coaches));
});

export default router;
