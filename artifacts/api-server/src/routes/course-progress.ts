import { Router, type IRouter } from "express";
import { db, courseProgressTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

const STATIC_VALID_COURSE_IDS = new Set([
  "quick-start",
  "finding-your-edge",
  "21-day-blitz",
  "live-coaching",
  "7-pillars",
  "direct-edge",
]);

function isValidCourseId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  if (STATIC_VALID_COURSE_IDS.has(id)) return true;
  // Blitz Caterpillar Edition hub steps 1-18
  const m = id.match(/^blitz-hub-step-(\d+)$/);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 18;
  }
  return false;
}

router.get("/course-progress", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const entries = await db
    .select()
    .from(courseProgressTable)
    .where(eq(courseProgressTable.userId, userId));
  res.json(entries);
});

router.post("/course-progress", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { courseId } = req.body;

  if (!isValidCourseId(courseId)) {
    res.status(400).json({ error: "Invalid courseId" });
    return;
  }

  const existing = await db
    .select()
    .from(courseProgressTable)
    .where(
      and(
        eq(courseProgressTable.userId, userId),
        eq(courseProgressTable.courseId, courseId)
      )
    );

  if (existing.length > 0) {
    res.json(existing[0]);
    return;
  }

  try {
    const [entry] = await db
      .insert(courseProgressTable)
      .values({ userId, courseId })
      .onConflictDoNothing()
      .returning();

    if (!entry) {
      const [fallback] = await db
        .select()
        .from(courseProgressTable)
        .where(
          and(
            eq(courseProgressTable.userId, userId),
            eq(courseProgressTable.courseId, courseId)
          )
        );
      res.json(fallback);
      return;
    }

    res.status(201).json(entry);
  } catch {
    const [fallback] = await db
      .select()
      .from(courseProgressTable)
      .where(
        and(
          eq(courseProgressTable.userId, userId),
          eq(courseProgressTable.courseId, courseId)
        )
      );
    if (fallback) {
      res.json(fallback);
      return;
    }
    res.status(500).json({ error: "Failed to save progress" });
  }
});

router.delete("/course-progress/:courseId", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { courseId } = req.params;

  if (!isValidCourseId(courseId)) {
    res.status(400).json({ error: "Invalid courseId" });
    return;
  }

  await db
    .delete(courseProgressTable)
    .where(
      and(
        eq(courseProgressTable.userId, userId),
        eq(courseProgressTable.courseId, courseId)
      )
    );

  res.json({ success: true });
});

export default router;
