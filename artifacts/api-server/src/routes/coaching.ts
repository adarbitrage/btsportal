import { Router, type IRouter } from "express";
import { db, coachingCallsTable, coachesTable, tiersTable, usersTable } from "@workspace/db";
import { eq, gte, lt } from "drizzle-orm";
import { ListCoachingCallsResponse, ListCoachesResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const userId = 1;
const tierLevels: Record<string, number> = { bronze: 1, silver: 2, gold: 3, diamond: 4 };

router.get("/coaching-calls", async (req, res): Promise<void> => {
  const upcoming = req.query.upcoming === "true";
  const now = new Date();

  let calls;
  if (upcoming) {
    calls = await db
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
        minimumTier: coachingCallsTable.minimumTier,
        recordingUrl: coachingCallsTable.recordingUrl,
        registeredCount: coachingCallsTable.registeredCount,
      })
      .from(coachingCallsTable)
      .innerJoin(coachesTable, eq(coachingCallsTable.coachId, coachesTable.id))
      .where(gte(coachingCallsTable.scheduledAt, now))
      .orderBy(coachingCallsTable.scheduledAt);
  } else {
    calls = await db
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
        minimumTier: coachingCallsTable.minimumTier,
        recordingUrl: coachingCallsTable.recordingUrl,
        registeredCount: coachingCallsTable.registeredCount,
      })
      .from(coachingCallsTable)
      .innerJoin(coachesTable, eq(coachingCallsTable.coachId, coachesTable.id))
      .orderBy(coachingCallsTable.scheduledAt);
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const [tier] = user ? await db.select().from(tiersTable).where(eq(tiersTable.id, user.tierId)) : [null];
  const userTierLevel = tier ? tier.level : 1;

  const mapped = calls.map((c) => ({
    ...c,
    isAccessible: userTierLevel >= (tierLevels[c.minimumTier] ?? 0),
  }));

  res.json(ListCoachingCallsResponse.parse(mapped));
});

router.get("/coaches", async (_req, res): Promise<void> => {
  const coaches = await db.select().from(coachesTable);
  res.json(ListCoachesResponse.parse(coaches));
});

export default router;
