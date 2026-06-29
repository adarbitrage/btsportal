import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { blitzLessonsTable } from "@workspace/db/schema";
import { and, eq, ne, asc } from "drizzle-orm";

const router = Router();

router.get("/blitz/lessons", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: blitzLessonsTable.id,
        title: blitzLessonsTable.title,
        category: blitzLessonsTable.category,
        tags: blitzLessonsTable.tags,
        sourceVideoTitle: blitzLessonsTable.sourceVideoTitle,
        phase: blitzLessonsTable.phase,
        module: blitzLessonsTable.module,
        lessonId: blitzLessonsTable.lessonId,
        lessonType: blitzLessonsTable.lessonType,
        networkPath: blitzLessonsTable.networkPath,
        publisherPath: blitzLessonsTable.publisherPath,
        blitzOrder: blitzLessonsTable.blitzOrder,
      })
      .from(blitzLessonsTable)
      .where(ne(blitzLessonsTable.status, "rejected"))
      .orderBy(asc(blitzLessonsTable.blitzOrder), asc(blitzLessonsTable.id));

    res.json({ lessons: rows });
  } catch (err) {
    console.error("[blitz-lessons] list error:", err);
    res.status(500).json({ error: "Failed to load Blitz lessons" });
  }
});

router.get("/blitz/lessons/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid lesson id" });
      return;
    }

    const [row] = await db
      .select()
      .from(blitzLessonsTable)
      .where(
        and(
          eq(blitzLessonsTable.id, id),
          ne(blitzLessonsTable.status, "rejected"),
        ),
      )
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }

    res.json({
      lesson: {
        id: row.id,
        title: row.title,
        category: row.category,
        tags: row.tags,
        content: row.editedContent || row.content,
        sourceVideoTitle: row.sourceVideoTitle,
        sourceVideoId: row.sourceVideoId,
        phase: row.phase,
        module: row.module,
        lessonId: row.lessonId,
        lessonType: row.lessonType,
        networkPath: row.networkPath,
        publisherPath: row.publisherPath,
        blitzOrder: row.blitzOrder,
      },
    });
  } catch (err) {
    console.error("[blitz-lessons] detail error:", err);
    res.status(500).json({ error: "Failed to load lesson" });
  }
});

export default router;
