import { Router, type IRouter } from "express";
import { db, blitzEventsTable, blitzDailyActivityTable, blitzPhasesTable, courseProgressTable } from "@workspace/db";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { isAdminRole } from "../middleware/rbac";
import { usersTable } from "@workspace/db";
import { sendError, ErrorCodes } from "../lib/api-errors";
import {
  BLITZ_SECTIONS,
  BLITZ_PHASES,
  BLITZ_PHASE_ORDER,
  BLITZ_PHASE_LESSON_COUNTS,
  buildBlitzCourseId,
  isValidBlitzCourseId,
  blitzLessonIdFromCourseId,
  type BlitzPhaseKey,
} from "../lib/blitz/sections";

const router: IRouter = Router();

const VALID_EVENT_TYPES = new Set(["viewed", "completed", "uncompleted"]);

// All curriculum identity (count, courseId format, lesson→phase map, phase
// order/counts) now comes from the shared @workspace/blitz-curriculum package
// via ../lib/blitz/sections. These aliases keep the local call sites readable.
type PhaseSlug = BlitzPhaseKey;

const isValidCourseId = isValidBlitzCourseId;
const lessonIdFromCourseId = blitzLessonIdFromCourseId;

const PHASE_ORDER: readonly PhaseSlug[] = BLITZ_PHASE_ORDER;
const PHASE_LESSON_COUNTS: Readonly<Record<PhaseSlug, number>> = BLITZ_PHASE_LESSON_COUNTS;

async function seedPhases(): Promise<void> {
  const phases = BLITZ_PHASES.map((p) => ({
    slug: p.key,
    name: p.label,
    sortOrder: p.sortOrder,
    color: p.color,
  }));
  await db
    .insert(blitzPhasesTable)
    .values(phases)
    .onConflictDoNothing();
}

let phasesSeedDone = false;
async function ensurePhasesSeed(): Promise<void> {
  if (phasesSeedDone) return;
  await seedPhases();
  phasesSeedDone = true;
}

async function upsertDailyActivity(userId: number, today: string): Promise<void> {
  await db
    .insert(blitzDailyActivityTable)
    .values({ userId, activityDate: today, eventCount: 1 })
    .onConflictDoUpdate({
      target: [blitzDailyActivityTable.userId, blitzDailyActivityTable.activityDate],
      set: { eventCount: sql`${blitzDailyActivityTable.eventCount} + 1` },
    });
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

router.post("/blitz/events", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { courseId, eventType, videoPositionSeconds, scrollPositionPct } = req.body;

  if (!isValidCourseId(courseId)) {
    sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid courseId");
    return;
  }

  if (!VALID_EVENT_TYPES.has(eventType)) {
    sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid eventType — must be viewed | completed | uncompleted");
    return;
  }

  if (videoPositionSeconds !== undefined && videoPositionSeconds !== null) {
    if (!Number.isInteger(videoPositionSeconds) || videoPositionSeconds < 0) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "videoPositionSeconds must be a non-negative integer");
      return;
    }
  }

  if (scrollPositionPct !== undefined && scrollPositionPct !== null) {
    if (typeof scrollPositionPct !== "number" || scrollPositionPct < 0 || scrollPositionPct > 100) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "scrollPositionPct must be between 0 and 100");
      return;
    }
  }

  const today = todayDate();

  const [event] = await db
    .insert(blitzEventsTable)
    .values({
      userId,
      courseId,
      eventType,
      videoPositionSeconds: videoPositionSeconds ?? null,
      scrollPositionPct: scrollPositionPct ?? null,
    })
    .returning();

  await upsertDailyActivity(userId, today);

  if (eventType === "completed") {
    await db
      .insert(courseProgressTable)
      .values({ userId, courseId })
      .onConflictDoNothing();
  } else if (eventType === "uncompleted") {
    await db
      .delete(courseProgressTable)
      .where(
        and(
          eq(courseProgressTable.userId, userId),
          eq(courseProgressTable.courseId, courseId),
        ),
      );
  }

  res.status(201).json({ event });
});

router.get("/blitz/continue", async (req, res): Promise<void> => {
  const userId = req.userId!;

  const completions = await db
    .select({ courseId: courseProgressTable.courseId })
    .from(courseProgressTable)
    .where(eq(courseProgressTable.userId, userId));

  const completedIds = new Set(
    completions
      .map((r) => lessonIdFromCourseId(r.courseId))
      .filter((n) => n > 0),
  );

  const lastViewed = await db
    .select({
      courseId: blitzEventsTable.courseId,
      videoPositionSeconds: blitzEventsTable.videoPositionSeconds,
      occurredAt: blitzEventsTable.occurredAt,
    })
    .from(blitzEventsTable)
    .where(
      and(
        eq(blitzEventsTable.userId, userId),
        eq(blitzEventsTable.eventType, "viewed"),
      ),
    )
    .orderBy(desc(blitzEventsTable.occurredAt))
    .limit(1);

  if (completedIds.size === 0 && lastViewed.length === 0) {
    const first = BLITZ_SECTIONS[0];
    res.json({
      status: "new",
      sectionId: first.id,
      courseId: buildBlitzCourseId(first.id),
      savedPositionSeconds: null,
    });
    return;
  }

  if (lastViewed.length > 0) {
    const lv = lastViewed[0];
    const lessonId = lessonIdFromCourseId(lv.courseId);
    if (lessonId > 0) {
      const isCompleted = completedIds.has(lessonId);
      if (!isCompleted) {
        res.json({
          status: "in_progress",
          sectionId: lessonId,
          courseId: lv.courseId,
          savedPositionSeconds: lv.videoPositionSeconds ?? null,
        });
        return;
      }
    }
  }

  const allLessonIds = BLITZ_SECTIONS.map((s) => s.id);
  const nextIncomplete = allLessonIds.find((id) => !completedIds.has(id));

  if (nextIncomplete === undefined) {
    res.json({
      status: "complete",
      sectionId: null,
      courseId: null,
      savedPositionSeconds: null,
    });
    return;
  }

  res.json({
    status: "returning",
    sectionId: nextIncomplete,
    courseId: buildBlitzCourseId(nextIncomplete),
    savedPositionSeconds: null,
  });
});

router.get("/blitz/streak", async (req, res): Promise<void> => {
  const userId = req.userId!;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 83);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const rows = await db
    .select({
      activityDate: blitzDailyActivityTable.activityDate,
      eventCount: blitzDailyActivityTable.eventCount,
    })
    .from(blitzDailyActivityTable)
    .where(
      and(
        eq(blitzDailyActivityTable.userId, userId),
        gte(blitzDailyActivityTable.activityDate, cutoffDate),
      ),
    )
    .orderBy(desc(blitzDailyActivityTable.activityDate));

  const activeDates = new Set(rows.map((r) => r.activityDate));

  function computeStreak(fromDate: string): number {
    let streak = 0;
    const cur = new Date(fromDate + "T12:00:00Z");
    while (true) {
      const d = cur.toISOString().slice(0, 10);
      if (!activeDates.has(d)) break;
      streak++;
      cur.setDate(cur.getDate() - 1);
    }
    return streak;
  }

  const today = todayDate();

  const dailyStreak = activeDates.has(today) ? computeStreak(today) : 0;

  let longestStreak = 0;
  const sortedDates = Array.from(activeDates).sort();
  let runLen = 0;
  let prevDate: Date | null = null;
  for (const d of sortedDates) {
    const cur = new Date(d + "T12:00:00Z");
    if (prevDate) {
      const diff = Math.round(
        (cur.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diff === 1) {
        runLen++;
      } else {
        runLen = 1;
      }
    } else {
      runLen = 1;
    }
    if (runLen > longestStreak) longestStreak = runLen;
    prevDate = cur;
  }

  const dateMap = new Map(rows.map((r) => [r.activityDate, r.eventCount]));
  const heatmap: { date: string; count: number }[] = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today + "T12:00:00Z");
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    heatmap.push({ date: ds, count: dateMap.get(ds) ?? 0 });
  }

  const last4WeeksActive = heatmap
    .slice(-28)
    .filter((h) => h.count > 0).length > 0
    ? heatmap.slice(-28).reduce(
        (acc, h, i) => {
          const weekIdx = Math.floor(i / 7);
          if (h.count > 0) acc[weekIdx] = true;
          return acc;
        },
        {} as Record<number, boolean>,
      )
    : {};

  const weeksActiveLast4 = Object.values(last4WeeksActive).filter(Boolean).length;

  const last12WeeksActive = heatmap.reduce(
    (acc, h, i) => {
      const weekIdx = Math.floor(i / 7);
      if (h.count > 0) acc[weekIdx] = true;
      return acc;
    },
    {} as Record<number, boolean>,
  );
  const weeksActiveLast12 = Object.values(last12WeeksActive).filter(Boolean).length;

  res.json({
    dailyStreak,
    longestDailyStreak: longestStreak,
    weeksActiveLast4,
    weeksActiveLast12,
    heatmap,
  });
});

router.get("/blitz/phase-status", async (req, res): Promise<void> => {
  await ensurePhasesSeed();

  const userId = req.userId!;

  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const isAdmin = user ? isAdminRole(user.role) : false;
  const isCoach = user?.role === "coach";

  const completions = await db
    .select({ courseId: courseProgressTable.courseId })
    .from(courseProgressTable)
    .where(eq(courseProgressTable.userId, userId));

  const completedIds = new Set(
    completions
      .map((r) => lessonIdFromCourseId(r.courseId))
      .filter((n) => n > 0),
  );

  const phases = await db
    .select()
    .from(blitzPhasesTable)
    .orderBy(blitzPhasesTable.sortOrder);

  const phaseCompletionPct: Record<string, number> = {};
  for (const phase of PHASE_ORDER) {
    const lessonsInPhase = BLITZ_SECTIONS.filter((s) => s.phase === phase);
    const completedInPhase = lessonsInPhase.filter((s) => completedIds.has(s.id)).length;
    phaseCompletionPct[phase] = lessonsInPhase.length > 0
      ? Math.round((completedInPhase / lessonsInPhase.length) * 100)
      : 0;
  }

  const result = phases.map((phase, idx) => {
    const slug = phase.slug as PhaseSlug;
    const completionPct = phaseCompletionPct[slug] ?? 0;

    let unlocked: boolean;
    if (isAdmin || isCoach) {
      unlocked = true;
    } else if (idx === 0) {
      unlocked = true;
    } else {
      const prevPhase = PHASE_ORDER[idx - 1];
      unlocked = (phaseCompletionPct[prevPhase] ?? 0) >= 80;
    }

    return {
      slug: phase.slug,
      name: phase.name,
      sortOrder: phase.sortOrder,
      color: phase.color,
      totalLessons: PHASE_LESSON_COUNTS[slug] ?? 0,
      completedLessons: BLITZ_SECTIONS.filter(
        (s) => s.phase === slug && completedIds.has(s.id),
      ).length,
      completionPct,
      unlocked,
    };
  });

  res.json({ phases: result, adminOverride: isAdmin || isCoach });
});

export default router;
