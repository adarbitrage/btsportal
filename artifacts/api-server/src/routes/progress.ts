import { Router, type IRouter } from "express";
import { db, progressTable, lessonsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ListProgressResponse, MarkLessonCompleteBody } from "@workspace/api-zod";
import { getUserEntitlements } from "../lib/entitlements";

const router: IRouter = Router();

router.get("/progress", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const entries = await db.select().from(progressTable).where(eq(progressTable.userId, userId)).orderBy(progressTable.completedAt);
  res.json(ListProgressResponse.parse(entries));
});

router.post("/progress", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const parsed = MarkLessonCompleteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [lesson] = await db.select().from(lessonsTable).where(eq(lessonsTable.id, parsed.data.lessonId));
  if (!lesson) {
    res.status(404).json({ error: "Lesson not found" });
    return;
  }

  const entitlements = await getUserEntitlements(userId);
  if (!entitlements.has(lesson.requiredEntitlement)) {
    res.status(403).json({ error: "You do not have access to this lesson. Upgrade your plan to unlock it." });
    return;
  }

  const existing = await db
    .select()
    .from(progressTable)
    .where(eq(progressTable.userId, userId));
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
