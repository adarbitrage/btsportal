import { Router, type IRouter } from "express";
import { db, progressTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ListProgressResponse, MarkLessonCompleteBody } from "@workspace/api-zod";

const router: IRouter = Router();

const userId = 1;

router.get("/progress", async (_req, res): Promise<void> => {
  const entries = await db.select().from(progressTable).where(eq(progressTable.userId, userId)).orderBy(progressTable.completedAt);
  res.json(ListProgressResponse.parse(entries));
});

router.post("/progress", async (req, res): Promise<void> => {
  const parsed = MarkLessonCompleteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(progressTable)
    .where(
      eq(progressTable.userId, userId)
    );
  const alreadyDone = existing.find((p) => p.lessonId === parsed.data.lessonId);
  if (alreadyDone) {
    res.status(200).json(alreadyDone);
    return;
  }

  const [entry] = await db
    .insert(progressTable)
    .values({ userId, lessonId: parsed.data.lessonId })
    .returning();

  res.status(201).json(entry);
});

export default router;
