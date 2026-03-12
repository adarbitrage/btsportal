import { Router, type IRouter } from "express";
import { db, usersTable, tiersTable, lessonsTable, progressTable, ticketsTable, coachingCallsTable, coachesTable, announcementsTable, modulesTable, tracksTable } from "@workspace/db";
import { eq, count, gte, and, sql, desc } from "drizzle-orm";
import { GetDashboardResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard", async (_req, res): Promise<void> => {
  const userId = 1;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [tier] = await db.select().from(tiersTable).where(eq(tiersTable.id, user.tierId));

  const [totalLessonsResult] = await db.select({ count: count() }).from(lessonsTable);
  const totalLessons = totalLessonsResult?.count ?? 0;

  const [completedResult] = await db.select({ count: count() }).from(progressTable).where(eq(progressTable.userId, userId));
  const lessonsCompleted = completedResult?.count ?? 0;

  const [openTicketsResult] = await db.select({ count: count() }).from(ticketsTable).where(and(eq(ticketsTable.userId, userId), sql`${ticketsTable.status} NOT IN ('resolved', 'closed')`));
  const openTickets = openTicketsResult?.count ?? 0;

  const daysSinceJoined = Math.floor((Date.now() - new Date(user.memberSince).getTime()) / (1000 * 60 * 60 * 24));

  const overallProgress = totalLessons > 0 ? Math.round((lessonsCompleted / totalLessons) * 100) : 0;

  const hoursLearned = lessonsCompleted * 0.5;

  const now = new Date();
  const upcomingCalls = await db
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
    .orderBy(coachingCallsTable.scheduledAt)
    .limit(3);

  const tierLevel = tier?.level ?? 0;
  const tierLevels: Record<string, number> = { bronze: 1, silver: 2, gold: 3, diamond: 4 };

  const upcomingCallsMapped = upcomingCalls.map((c) => ({
    ...c,
    isAccessible: tierLevel >= (tierLevels[c.minimumTier] ?? 0),
  }));

  const recentAnnouncements = await db.select().from(announcementsTable).orderBy(desc(announcementsTable.createdAt)).limit(5);

  const nextLessonData = await db
    .select()
    .from(lessonsTable)
    .where(
      sql`${lessonsTable.id} NOT IN (SELECT ${progressTable.lessonId} FROM ${progressTable} WHERE ${progressTable.userId} = ${userId})`
    )
    .orderBy(lessonsTable.moduleId, lessonsTable.sortOrder)
    .limit(1);

  let nextLesson = undefined;
  if (nextLessonData.length > 0) {
    const nl = nextLessonData[0];
    const [mod] = await db.select().from(modulesTable).where(eq(modulesTable.id, nl.moduleId));
    let trackName = "Unknown";
    if (mod) {
      const [trk] = await db.select().from(tracksTable).where(eq(tracksTable.id, mod.trackId));
      trackName = trk?.title ?? "Unknown";
    }
    nextLesson = {
      lessonId: nl.id,
      lessonTitle: nl.title,
      moduleName: mod?.title ?? "Unknown",
      trackName,
      durationMinutes: nl.durationMinutes,
    };
  }

  const result = {
    memberName: user.name,
    tierName: tier?.name ?? "Bronze",
    tierSlug: tier?.slug ?? "bronze",
    memberSince: user.memberSince.toISOString().split("T")[0],
    daysSinceJoined,
    lessonsCompleted,
    totalLessons,
    hoursLearned,
    currentStreak: user.currentStreak,
    openTickets,
    overallProgress,
    nextLesson,
    upcomingCalls: upcomingCallsMapped,
    recentAnnouncements,
  };

  res.json(GetDashboardResponse.parse(result));
});

export default router;
