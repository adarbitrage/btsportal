import { Router, type IRouter } from "express";
import { db, tracksTable, modulesTable, lessonsTable, progressTable } from "@workspace/db";
import { eq, count, sql, and } from "drizzle-orm";
import { ListTracksResponse, GetModuleParams, GetModuleResponse, GetLessonParams, GetLessonResponse } from "@workspace/api-zod";
import { getUserEntitlements } from "../lib/entitlements";

const router: IRouter = Router();

router.get("/tracks", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const entitlements = await getUserEntitlements(userId);
  const tracks = await db.select().from(tracksTable)
    .where(and(eq(tracksTable.status, "published"), eq(tracksTable.archived, false)))
    .orderBy(tracksTable.sortOrder);

  const result = [];
  for (const track of tracks) {
    const isLocked = !entitlements.has(track.requiredEntitlement);
    const modules = await db.select().from(modulesTable).where(eq(modulesTable.trackId, track.id)).orderBy(modulesTable.sortOrder);

    let totalLessons = 0;
    let totalCompleted = 0;
    let totalMinutes = 0;
    const moduleSummaries = [];

    for (const mod of modules) {
      const lessons = await db.select().from(lessonsTable).where(and(eq(lessonsTable.moduleId, mod.id), eq(lessonsTable.status, "published")));
      const modLessonCount = lessons.length;
      const modMinutes = lessons.reduce((acc, l) => acc + l.durationMinutes, 0);

      const [completedResult] = await db
        .select({ count: count() })
        .from(progressTable)
        .where(
          sql`${progressTable.userId} = ${userId} AND ${progressTable.lessonId} IN (SELECT id FROM lessons WHERE module_id = ${mod.id})`
        );
      const modCompleted = completedResult?.count ?? 0;

      totalLessons += modLessonCount;
      totalCompleted += modCompleted;
      totalMinutes += modMinutes;

      moduleSummaries.push({
        id: mod.id,
        title: mod.title,
        sortOrder: mod.sortOrder,
        totalLessons: modLessonCount,
        completedLessons: modCompleted,
        progress: modLessonCount > 0 ? Math.round((modCompleted / modLessonCount) * 100) : 0,
      });
    }

    const progress = totalLessons > 0 ? Math.round((totalCompleted / totalLessons) * 100) : 0;

    result.push({
      id: track.id,
      title: track.title,
      description: track.description,
      requiredEntitlement: track.requiredEntitlement,
      isLocked,
      sortOrder: track.sortOrder,
      totalModules: modules.length,
      totalLessons,
      estimatedMinutes: totalMinutes,
      progress,
      isCurrent: progress > 0 && progress < 100,
      modules: moduleSummaries,
    });
  }

  res.json(ListTracksResponse.parse(result));
});

router.get("/modules/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = GetModuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [mod] = await db.select().from(modulesTable).where(eq(modulesTable.id, params.data.id));
  if (!mod) {
    res.status(404).json({ error: "Module not found" });
    return;
  }

  const entitlements = await getUserEntitlements(userId);
  const lessons = await db.select().from(lessonsTable)
    .where(and(eq(lessonsTable.moduleId, mod.id), eq(lessonsTable.status, "published")))
    .orderBy(lessonsTable.sortOrder);

  const completedIds = await db
    .select({ lessonId: progressTable.lessonId })
    .from(progressTable)
    .where(eq(progressTable.userId, userId));
  const completedSet = new Set(completedIds.map((p) => p.lessonId));

  const mappedLessons = lessons.map((l) => ({
    ...l,
    isCompleted: completedSet.has(l.id),
    isLocked: !entitlements.has(l.requiredEntitlement),
  }));

  res.json(GetModuleResponse.parse({ ...mod, lessons: mappedLessons }));
});

router.get("/lessons/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = GetLessonParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [lesson] = await db.select().from(lessonsTable).where(and(eq(lessonsTable.id, params.data.id), eq(lessonsTable.status, "published")));
  if (!lesson) {
    res.status(404).json({ error: "Lesson not found" });
    return;
  }

  const entitlements = await getUserEntitlements(userId);
  const isLocked = !entitlements.has(lesson.requiredEntitlement);

  if (isLocked) {
    res.status(403).json({ error: "You do not have access to this lesson. Upgrade your plan to unlock it." });
    return;
  }

  const [progress] = await db
    .select()
    .from(progressTable)
    .where(sql`${progressTable.userId} = ${userId} AND ${progressTable.lessonId} = ${lesson.id}`);

  res.json(
    GetLessonResponse.parse({
      ...lesson,
      isCompleted: !!progress,
      isLocked: false,
    })
  );
});

export default router;
