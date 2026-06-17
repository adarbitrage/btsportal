import { Router, type IRouter } from "express";
import { db, usersTable, lessonsTable, progressTable, ticketsTable, coachingCallsTable, coachesTable, announcementsTable, modulesTable, tracksTable, toolsTable, toolUsageLogTable } from "@workspace/db";
import { eq, count, gte, and, sql, desc } from "drizzle-orm";
import { getUserEntitlements, getUserProducts, getHighestProductLabel, getSupportTicketLimit, getEntitlementsList } from "../lib/entitlements";

const router: IRouter = Router();

router.get("/dashboard", async (req, res): Promise<void> => {
  const userId = req.userId!;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const entitlements = await getUserEntitlements(userId);
  const ownedProducts = await getUserProducts(userId);
  const highest = getHighestProductLabel(entitlements);
  const ticketLimit = getSupportTicketLimit(entitlements);

  const accessibleLessons = await db.select().from(lessonsTable);
  const accessible = accessibleLessons.filter(l => entitlements.has(l.requiredEntitlement));
  const totalLessons = accessible.length;

  const [completedResult] = await db.select({ count: count() }).from(progressTable).where(eq(progressTable.userId, userId));
  const lessonsCompleted = Math.min(completedResult?.count ?? 0, totalLessons);

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
      requiredEntitlement: coachingCallsTable.requiredEntitlement,
      recordingUrl: coachingCallsTable.recordingUrl,
      registeredCount: coachingCallsTable.registeredCount,
    })
    .from(coachingCallsTable)
    .innerJoin(coachesTable, eq(coachingCallsTable.coachId, coachesTable.id))
    .where(gte(coachingCallsTable.scheduledAt, now))
    .orderBy(coachingCallsTable.scheduledAt)
    .limit(3);

  const upcomingCallsMapped = upcomingCalls.map((c) => {
    const isAccessible = entitlements.has(c.requiredEntitlement);
    return {
      ...c,
      isAccessible,
      meetLink: isAccessible ? c.meetLink : null,
      recordingUrl: isAccessible ? c.recordingUrl : null,
    };
  });

  const recentAnnouncements = await db.select().from(announcementsTable).orderBy(desc(announcementsTable.createdAt)).limit(5);

  const nextLessonData = await db
    .select()
    .from(lessonsTable)
    .where(
      sql`${lessonsTable.id} NOT IN (SELECT ${progressTable.lessonId} FROM ${progressTable} WHERE ${progressTable.userId} = ${userId})`
    )
    .orderBy(lessonsTable.moduleId, lessonsTable.sortOrder);

  let nextLesson = undefined;
  const nextAccessible = nextLessonData.find(l => entitlements.has(l.requiredEntitlement));
  if (nextAccessible) {
    const [mod] = await db.select().from(modulesTable).where(eq(modulesTable.id, nextAccessible.moduleId));
    let trackName = "Unknown";
    if (mod) {
      const [trk] = await db.select().from(tracksTable).where(eq(tracksTable.id, mod.trackId));
      trackName = trk?.title ?? "Unknown";
    }
    nextLesson = {
      lessonId: nextAccessible.id,
      lessonTitle: nextAccessible.title,
      moduleName: mod?.title ?? "Unknown",
      trackName,
      durationMinutes: nextAccessible.durationMinutes,
    };
  }

  let recentTools: any[] = [];
  if (entitlements.has("software:base") || entitlements.has("software:expanded")) {
    const recentUsage = await db
      .select({
        toolId: toolUsageLogTable.toolId,
        lastUsed: sql<Date>`MAX(${toolUsageLogTable.createdAt})`.as("last_used"),
      })
      .from(toolUsageLogTable)
      .where(eq(toolUsageLogTable.userId, userId))
      .groupBy(toolUsageLogTable.toolId)
      .orderBy(sql`MAX(${toolUsageLogTable.createdAt}) DESC`)
      .limit(3);

    if (recentUsage.length > 0) {
      const toolIds = recentUsage.map((u) => u.toolId);
      const tools = await db
        .select({
          id: toolsTable.id,
          slug: toolsTable.slug,
          name: toolsTable.name,
          shortDescription: toolsTable.shortDescription,
          icon: toolsTable.icon,
          isFeatured: toolsTable.isFeatured,
          requiredEntitlement: toolsTable.requiredEntitlement,
        })
        .from(toolsTable)
        .where(sql`${toolsTable.id} IN (${sql.join(toolIds.map(id => sql`${id}`), sql`, `)})`);

      recentTools = toolIds
        .map((id) => tools.find((t) => t.id === id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t) && entitlements.has(t!.requiredEntitlement))
        .map(({ requiredEntitlement, ...t }) => ({ ...t, isFeatured: t.isFeatured === 1 }));
    }

    if (recentTools.length < 3) {
      const featuredTools = await db
        .select({
          id: toolsTable.id,
          slug: toolsTable.slug,
          name: toolsTable.name,
          shortDescription: toolsTable.shortDescription,
          icon: toolsTable.icon,
          isFeatured: toolsTable.isFeatured,
          requiredEntitlement: toolsTable.requiredEntitlement,
        })
        .from(toolsTable)
        .where(and(eq(toolsTable.status, "active"), eq(toolsTable.isFeatured, 1)))
        .orderBy(toolsTable.sortOrder)
        .limit(3);

      const existingIds = new Set(recentTools.map((t: any) => t.id));
      for (const ft of featuredTools) {
        if (
          !existingIds.has(ft.id) &&
          recentTools.length < 3 &&
          entitlements.has(ft.requiredEntitlement)
        ) {
          const { requiredEntitlement, ...rest } = ft;
          recentTools.push({ ...rest, isFeatured: ft.isFeatured === 1 });
        }
      }
    }
  }

  const result = {
    memberName: user.name,
    highestProductName: highest.name,
    highestProductSlug: highest.slug,
    memberSince: user.memberSince.toISOString().split("T")[0],
    daysSinceJoined,
    lessonsCompleted,
    totalLessons,
    hoursLearned,
    currentStreak: user.currentStreak,
    openTickets,
    overallProgress,
    entitlements: getEntitlementsList(entitlements),
    ownedProducts: ownedProducts.map(p => p.productSlug),
    nextLesson,
    upcomingCalls: upcomingCallsMapped,
    recentAnnouncements,
    ticketLimit,
    recentTools,
  };

  res.json(result);
});

export default router;
