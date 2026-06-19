import { Router, type Request, type Response } from "express";
import { db, tracksTable, modulesTable, lessonsTable, entitlementKeySchema } from "@workspace/db";
import { eq, sql, count, asc } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";

const router = Router();

router.get("/admin/tracks", requirePermission("content:view"), async (_req: Request, res: Response) => {
  try {
    const tracks = await db.select().from(tracksTable).orderBy(asc(tracksTable.sortOrder));

    const result = [];
    for (const track of tracks) {
      const modules = await db.select().from(modulesTable).where(eq(modulesTable.trackId, track.id));
      let totalLessons = 0;
      for (const mod of modules) {
        const [lessonCount] = await db.select({ count: count() }).from(lessonsTable).where(eq(lessonsTable.moduleId, mod.id));
        totalLessons += lessonCount?.count ?? 0;
      }

      result.push({
        ...track,
        moduleCount: modules.length,
        lessonCount: totalLessons,
      });
    }

    res.json(result);
  } catch (error) {
    console.error("[Admin] Error listing tracks:", error);
    res.status(500).json({ error: "Failed to list tracks" });
  }
});

router.post("/admin/tracks", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const { title, description, requiredEntitlement, status } = req.body;

    if (!title || !description) {
      res.status(400).json({ error: "title and description are required" });
      return;
    }

    if (requiredEntitlement !== undefined) {
      const keyCheck = entitlementKeySchema.safeParse(requiredEntitlement);
      if (!keyCheck.success) {
        res.status(400).json({ error: `Invalid requiredEntitlement "${requiredEntitlement}". Must be a registered entitlement key.` });
        return;
      }
    }

    const [maxOrder] = await db
      .select({ max: sql<number>`COALESCE(MAX(${tracksTable.sortOrder}), -1)` })
      .from(tracksTable);

    const [track] = await db.insert(tracksTable).values({
      title,
      description,
      requiredEntitlement: requiredEntitlement || "content:frontend",
      status: status || "draft",
      sortOrder: (maxOrder?.max ?? -1) + 1,
    }).returning();

    res.status(201).json(track);
  } catch (error) {
    console.error("[Admin] Error creating track:", error);
    res.status(500).json({ error: "Failed to create track" });
  }
});

router.put("/admin/tracks/:id", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid track ID" });
      return;
    }

    const { title, description, requiredEntitlement, status, sortOrder } = req.body;

    if (requiredEntitlement !== undefined) {
      const keyCheck = entitlementKeySchema.safeParse(requiredEntitlement);
      if (!keyCheck.success) {
        res.status(400).json({ error: `Invalid requiredEntitlement "${requiredEntitlement}". Must be a registered entitlement key.` });
        return;
      }
    }

    const updates: Record<string, any> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (requiredEntitlement !== undefined) updates.requiredEntitlement = requiredEntitlement;
    if (status !== undefined) updates.status = status;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db.update(tracksTable).set(updates).where(eq(tracksTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Track not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating track:", error);
    res.status(500).json({ error: "Failed to update track" });
  }
});

router.patch("/admin/tracks/reorder", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) {
      res.status(400).json({ error: "orders must be an array of { id, sortOrder }" });
      return;
    }

    for (const { id, sortOrder } of orders) {
      await db.update(tracksTable).set({ sortOrder }).where(eq(tracksTable.id, id));
    }

    const tracks = await db.select().from(tracksTable).orderBy(asc(tracksTable.sortOrder));
    res.json(tracks);
  } catch (error) {
    console.error("[Admin] Error reordering tracks:", error);
    res.status(500).json({ error: "Failed to reorder tracks" });
  }
});

router.patch("/admin/tracks/:id/archive", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid track ID" });
      return;
    }

    const [updated] = await db.update(tracksTable).set({
      archived: true,
      archivedAt: new Date(),
    }).where(eq(tracksTable.id, id)).returning();

    if (!updated) {
      res.status(404).json({ error: "Track not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error archiving track:", error);
    res.status(500).json({ error: "Failed to archive track" });
  }
});

router.patch("/admin/tracks/:id/unarchive", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid track ID" });
      return;
    }

    const [updated] = await db.update(tracksTable).set({
      archived: false,
      archivedAt: null,
    }).where(eq(tracksTable.id, id)).returning();

    if (!updated) {
      res.status(404).json({ error: "Track not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error unarchiving track:", error);
    res.status(500).json({ error: "Failed to unarchive track" });
  }
});

router.post("/admin/tracks/:id/duplicate", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid track ID" });
      return;
    }

    const [sourceTrack] = await db.select().from(tracksTable).where(eq(tracksTable.id, id));
    if (!sourceTrack) {
      res.status(404).json({ error: "Track not found" });
      return;
    }

    const [maxOrder] = await db
      .select({ max: sql<number>`COALESCE(MAX(${tracksTable.sortOrder}), -1)` })
      .from(tracksTable);

    const [newTrack] = await db.insert(tracksTable).values({
      title: `${sourceTrack.title} (Copy)`,
      description: sourceTrack.description,
      requiredEntitlement: sourceTrack.requiredEntitlement,
      status: "draft",
      sortOrder: (maxOrder?.max ?? -1) + 1,
    }).returning();

    const sourceModules = await db.select().from(modulesTable).where(eq(modulesTable.trackId, id)).orderBy(asc(modulesTable.sortOrder));

    for (const mod of sourceModules) {
      const [newModule] = await db.insert(modulesTable).values({
        trackId: newTrack.id,
        title: mod.title,
        description: mod.description,
        sortOrder: mod.sortOrder,
      }).returning();

      const sourceLessons = await db.select().from(lessonsTable).where(eq(lessonsTable.moduleId, mod.id)).orderBy(asc(lessonsTable.sortOrder));

      for (const lesson of sourceLessons) {
        await db.insert(lessonsTable).values({
          moduleId: newModule.id,
          title: lesson.title,
          description: lesson.description,
          videoUrl: lesson.videoUrl,
          contentType: lesson.contentType,
          textContent: lesson.textContent,
          actionItems: lesson.actionItems,
          durationMinutes: lesson.durationMinutes,
          requiredEntitlement: lesson.requiredEntitlement,
          sortOrder: lesson.sortOrder,
          status: "draft",
        });
      }
    }

    res.status(201).json(newTrack);
  } catch (error) {
    console.error("[Admin] Error duplicating track:", error);
    res.status(500).json({ error: "Failed to duplicate track" });
  }
});

export default router;
