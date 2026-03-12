import { Router, type Request, type Response } from "express";
import { db, modulesTable, lessonsTable, progressTable } from "@workspace/db";
import { eq, sql, count, asc } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/admin/tracks/:trackId/modules", requireAdmin, async (req: Request, res: Response) => {
  try {
    const trackId = parseInt(req.params.trackId as string, 10);
    if (isNaN(trackId)) {
      res.status(400).json({ error: "Invalid track ID" });
      return;
    }

    const modules = await db.select().from(modulesTable)
      .where(eq(modulesTable.trackId, trackId))
      .orderBy(asc(modulesTable.sortOrder));

    const result = [];
    for (const mod of modules) {
      const [lessonCount] = await db.select({ count: count() }).from(lessonsTable).where(eq(lessonsTable.moduleId, mod.id));
      result.push({
        ...mod,
        lessonCount: lessonCount?.count ?? 0,
      });
    }

    res.json(result);
  } catch (error) {
    console.error("[Admin] Error listing modules:", error);
    res.status(500).json({ error: "Failed to list modules" });
  }
});

router.post("/admin/modules", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { trackId, title, description } = req.body;

    if (!trackId || !title || !description) {
      res.status(400).json({ error: "trackId, title, and description are required" });
      return;
    }

    const [maxOrder] = await db
      .select({ max: sql<number>`COALESCE(MAX(${modulesTable.sortOrder}), -1)` })
      .from(modulesTable)
      .where(eq(modulesTable.trackId, trackId));

    const [mod] = await db.insert(modulesTable).values({
      trackId,
      title,
      description,
      sortOrder: (maxOrder?.max ?? -1) + 1,
    }).returning();

    res.status(201).json(mod);
  } catch (error) {
    console.error("[Admin] Error creating module:", error);
    res.status(500).json({ error: "Failed to create module" });
  }
});

router.put("/admin/modules/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid module ID" });
      return;
    }

    const { title, description, sortOrder } = req.body;
    const updates: Record<string, any> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db.update(modulesTable).set(updates).where(eq(modulesTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Module not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating module:", error);
    res.status(500).json({ error: "Failed to update module" });
  }
});

router.patch("/admin/modules/reorder", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) {
      res.status(400).json({ error: "orders must be an array of { id, sortOrder }" });
      return;
    }

    for (const { id, sortOrder } of orders) {
      await db.update(modulesTable).set({ sortOrder }).where(eq(modulesTable.id, id));
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error reordering modules:", error);
    res.status(500).json({ error: "Failed to reorder modules" });
  }
});

router.patch("/admin/modules/:id/move", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid module ID" });
      return;
    }

    const { targetTrackId } = req.body;
    if (!targetTrackId) {
      res.status(400).json({ error: "targetTrackId is required" });
      return;
    }

    const [maxOrder] = await db
      .select({ max: sql<number>`COALESCE(MAX(${modulesTable.sortOrder}), -1)` })
      .from(modulesTable)
      .where(eq(modulesTable.trackId, targetTrackId));

    const [updated] = await db.update(modulesTable).set({
      trackId: targetTrackId,
      sortOrder: (maxOrder?.max ?? -1) + 1,
    }).where(eq(modulesTable.id, id)).returning();

    if (!updated) {
      res.status(404).json({ error: "Module not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error moving module:", error);
    res.status(500).json({ error: "Failed to move module" });
  }
});

router.delete("/admin/modules/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid module ID" });
      return;
    }

    const [progressCount] = await db
      .select({ count: count() })
      .from(progressTable)
      .where(
        sql`${progressTable.lessonId} IN (SELECT id FROM lessons WHERE module_id = ${id})`
      );

    const hasProgress = (progressCount?.count ?? 0) > 0;

    const lessons = await db.select({ id: lessonsTable.id }).from(lessonsTable).where(eq(lessonsTable.moduleId, id));
    for (const lesson of lessons) {
      await db.delete(progressTable).where(eq(progressTable.lessonId, lesson.id));
    }
    await db.delete(lessonsTable).where(eq(lessonsTable.moduleId, id));
    const [deleted] = await db.delete(modulesTable).where(eq(modulesTable.id, id)).returning();

    if (!deleted) {
      res.status(404).json({ error: "Module not found" });
      return;
    }

    res.json({
      ...deleted,
      hadMemberProgress: hasProgress,
      warning: hasProgress ? "This module had member progress data that was removed" : undefined,
    });
  } catch (error) {
    console.error("[Admin] Error deleting module:", error);
    res.status(500).json({ error: "Failed to delete module" });
  }
});

export default router;
