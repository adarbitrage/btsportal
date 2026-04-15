import { Router, type IRouter } from "express";
import { db, courseProgressTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

const VALID_COURSE_IDS = [
  "quick-start",
  "finding-your-edge",
  "21-day-blitz",
  "live-coaching",
  "7-pillars",
  "direct-edge",
];

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

  if (!courseId || !VALID_COURSE_IDS.includes(courseId)) {
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

  if (!VALID_COURSE_IDS.includes(courseId)) {
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
