import { Router, type Request, type Response } from "express";
import { db, lessonsTable, lessonVersionsTable, progressTable } from "@workspace/db";
import { eq, sql, asc, desc, count } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/admin/modules/:moduleId/lessons", requireAdmin, async (req: Request, res: Response) => {
  try {
    const moduleId = parseInt(req.params.moduleId as string, 10);
    if (isNaN(moduleId)) {
      res.status(400).json({ error: "Invalid module ID" });
      return;
    }

    const lessons = await db.select().from(lessonsTable)
      .where(eq(lessonsTable.moduleId, moduleId))
      .orderBy(asc(lessonsTable.sortOrder));

    res.json(lessons);
  } catch (error) {
    console.error("[Admin] Error listing lessons:", error);
    res.status(500).json({ error: "Failed to list lessons" });
  }
});

router.post("/admin/lessons", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { moduleId, title, description, videoUrl, contentType, textContent, actionItems, durationMinutes, requiredEntitlement, status } = req.body;

    if (!moduleId || !title || !description) {
      res.status(400).json({ error: "moduleId, title, and description are required" });
      return;
    }

    const [maxOrder] = await db
      .select({ max: sql<number>`COALESCE(MAX(${lessonsTable.sortOrder}), -1)` })
      .from(lessonsTable)
      .where(eq(lessonsTable.moduleId, moduleId));

    const [lesson] = await db.insert(lessonsTable).values({
      moduleId,
      title,
      description,
      videoUrl: videoUrl || null,
      contentType: contentType || "video",
      textContent: textContent || null,
      actionItems: actionItems || null,
      durationMinutes: durationMinutes || 10,
      requiredEntitlement: requiredEntitlement || "content:frontend",
      sortOrder: (maxOrder?.max ?? -1) + 1,
      status: status || "draft",
    }).returning();

    res.status(201).json(lesson);
  } catch (error) {
    console.error("[Admin] Error creating lesson:", error);
    res.status(500).json({ error: "Failed to create lesson" });
  }
});

router.put("/admin/lessons/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid lesson ID" });
      return;
    }

    const { title, description, videoUrl, contentType, textContent, actionItems, durationMinutes, requiredEntitlement, sortOrder, status } = req.body;
    const updates: Record<string, any> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (videoUrl !== undefined) updates.videoUrl = videoUrl;
    if (contentType !== undefined) updates.contentType = contentType;
    if (textContent !== undefined) updates.textContent = textContent;
    if (actionItems !== undefined) updates.actionItems = actionItems;
    if (durationMinutes !== undefined) updates.durationMinutes = durationMinutes;
    if (requiredEntitlement !== undefined) updates.requiredEntitlement = requiredEntitlement;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db.update(lessonsTable).set(updates).where(eq(lessonsTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating lesson:", error);
    res.status(500).json({ error: "Failed to update lesson" });
  }
});

router.patch("/admin/lessons/reorder", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) {
      res.status(400).json({ error: "orders must be an array of { id, sortOrder }" });
      return;
    }

    for (const { id, sortOrder } of orders) {
      await db.update(lessonsTable).set({ sortOrder }).where(eq(lessonsTable.id, id));
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error reordering lessons:", error);
    res.status(500).json({ error: "Failed to reorder lessons" });
  }
});

router.post("/admin/lessons/:id/duplicate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid lesson ID" });
      return;
    }

    const { targetModuleId } = req.body;

    const [source] = await db.select().from(lessonsTable).where(eq(lessonsTable.id, id));
    if (!source) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }

    const destModuleId = targetModuleId || source.moduleId;

    const [maxOrder] = await db
      .select({ max: sql<number>`COALESCE(MAX(${lessonsTable.sortOrder}), -1)` })
      .from(lessonsTable)
      .where(eq(lessonsTable.moduleId, destModuleId));

    const [newLesson] = await db.insert(lessonsTable).values({
      moduleId: destModuleId,
      title: `${source.title} (Copy)`,
      description: source.description,
      videoUrl: source.videoUrl,
      contentType: source.contentType,
      textContent: source.textContent,
      actionItems: source.actionItems,
      durationMinutes: source.durationMinutes,
      requiredEntitlement: source.requiredEntitlement,
      sortOrder: (maxOrder?.max ?? -1) + 1,
      status: "draft",
    }).returning();

    res.status(201).json(newLesson);
  } catch (error) {
    console.error("[Admin] Error duplicating lesson:", error);
    res.status(500).json({ error: "Failed to duplicate lesson" });
  }
});

router.delete("/admin/lessons/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid lesson ID" });
      return;
    }

    await db.delete(progressTable).where(eq(progressTable.lessonId, id));
    await db.delete(lessonVersionsTable).where(eq(lessonVersionsTable.lessonId, id));
    const [deleted] = await db.delete(lessonsTable).where(eq(lessonsTable.id, id)).returning();

    if (!deleted) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }

    res.json(deleted);
  } catch (error) {
    console.error("[Admin] Error deleting lesson:", error);
    res.status(500).json({ error: "Failed to delete lesson" });
  }
});

router.post("/admin/lessons/:id/publish", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid lesson ID" });
      return;
    }

    const { changeSummary } = req.body;

    const [lesson] = await db.select().from(lessonsTable).where(eq(lessonsTable.id, id));
    if (!lesson) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }

    const [latestVersion] = await db
      .select({ versionNumber: lessonVersionsTable.versionNumber })
      .from(lessonVersionsTable)
      .where(eq(lessonVersionsTable.lessonId, id))
      .orderBy(desc(lessonVersionsTable.versionNumber))
      .limit(1);

    const nextVersion = (latestVersion?.versionNumber ?? 0) + 1;

    const [version] = await db.insert(lessonVersionsTable).values({
      lessonId: id,
      versionNumber: nextVersion,
      title: lesson.title,
      contentType: lesson.contentType,
      videoUrl: lesson.videoUrl,
      textContent: lesson.textContent,
      actionItems: lesson.actionItems,
      publishedBy: req.userId!,
      changeSummary: changeSummary || null,
    }).returning();

    await db.update(lessonsTable).set({ status: "published" }).where(eq(lessonsTable.id, id));

    const [versionCount] = await db
      .select({ count: count() })
      .from(lessonVersionsTable)
      .where(eq(lessonVersionsTable.lessonId, id));

    if ((versionCount?.count ?? 0) > 20) {
      const oldVersions = await db
        .select({ id: lessonVersionsTable.id })
        .from(lessonVersionsTable)
        .where(eq(lessonVersionsTable.lessonId, id))
        .orderBy(desc(lessonVersionsTable.versionNumber))
        .offset(20);

      for (const old of oldVersions) {
        await db.delete(lessonVersionsTable).where(eq(lessonVersionsTable.id, old.id));
      }
    }

    res.status(201).json(version);
  } catch (error) {
    console.error("[Admin] Error publishing lesson:", error);
    res.status(500).json({ error: "Failed to publish lesson" });
  }
});

router.get("/admin/lessons/:id/versions", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid lesson ID" });
      return;
    }

    const versions = await db.select()
      .from(lessonVersionsTable)
      .where(eq(lessonVersionsTable.lessonId, id))
      .orderBy(desc(lessonVersionsTable.versionNumber));

    res.json(versions);
  } catch (error) {
    console.error("[Admin] Error listing versions:", error);
    res.status(500).json({ error: "Failed to list versions" });
  }
});

router.post("/admin/lessons/:id/restore/:versionId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const versionId = parseInt(req.params.versionId as string, 10);
    if (isNaN(id) || isNaN(versionId)) {
      res.status(400).json({ error: "Invalid lesson or version ID" });
      return;
    }

    const [version] = await db.select()
      .from(lessonVersionsTable)
      .where(eq(lessonVersionsTable.id, versionId));

    if (!version || version.lessonId !== id) {
      res.status(404).json({ error: "Version not found for this lesson" });
      return;
    }

    await db.update(lessonsTable).set({
      title: version.title,
      contentType: version.contentType,
      videoUrl: version.videoUrl,
      textContent: version.textContent,
      actionItems: version.actionItems,
    }).where(eq(lessonsTable.id, id));

    const [latestVersion] = await db
      .select({ versionNumber: lessonVersionsTable.versionNumber })
      .from(lessonVersionsTable)
      .where(eq(lessonVersionsTable.lessonId, id))
      .orderBy(desc(lessonVersionsTable.versionNumber))
      .limit(1);

    const [newVersion] = await db.insert(lessonVersionsTable).values({
      lessonId: id,
      versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
      title: version.title,
      contentType: version.contentType,
      videoUrl: version.videoUrl,
      textContent: version.textContent,
      actionItems: version.actionItems,
      publishedBy: req.userId!,
      changeSummary: `Restored from version ${version.versionNumber}`,
    }).returning();

    res.status(201).json(newVersion);
  } catch (error) {
    console.error("[Admin] Error restoring version:", error);
    res.status(500).json({ error: "Failed to restore version" });
  }
});

export default router;
