import { Router, type Request, type Response } from "express";
import { db, tracksTable, modulesTable, lessonsTable, lessonVersionsTable } from "@workspace/db";
import { eq, inArray, sql, asc, desc } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.post("/admin/lessons/bulk-publish", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { lessonIds } = req.body;
    if (!Array.isArray(lessonIds) || lessonIds.length === 0) {
      res.status(400).json({ error: "lessonIds must be a non-empty array" });
      return;
    }

    const results = [];
    for (const lessonId of lessonIds) {
      const [lesson] = await db.select().from(lessonsTable).where(eq(lessonsTable.id, lessonId));
      if (!lesson) continue;

      const [latestVersion] = await db
        .select({ versionNumber: lessonVersionsTable.versionNumber })
        .from(lessonVersionsTable)
        .where(eq(lessonVersionsTable.lessonId, lessonId))
        .orderBy(desc(lessonVersionsTable.versionNumber))
        .limit(1);

      const nextVersion = (latestVersion?.versionNumber ?? 0) + 1;

      await db.insert(lessonVersionsTable).values({
        lessonId,
        versionNumber: nextVersion,
        title: lesson.title,
        contentType: lesson.contentType,
        videoUrl: lesson.videoUrl,
        textContent: lesson.textContent,
        actionItems: lesson.actionItems,
        publishedBy: req.userId!,
        changeSummary: "Bulk publish",
      });

      await db.update(lessonsTable).set({ status: "published" }).where(eq(lessonsTable.id, lessonId));
      results.push({ id: lessonId, status: "published" });
    }

    res.json({ published: results });
  } catch (error) {
    console.error("[Admin] Error bulk publishing:", error);
    res.status(500).json({ error: "Failed to bulk publish" });
  }
});

router.post("/admin/lessons/bulk-move", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { lessonIds, targetModuleId } = req.body;
    if (!Array.isArray(lessonIds) || lessonIds.length === 0 || !targetModuleId) {
      res.status(400).json({ error: "lessonIds (non-empty array) and targetModuleId are required" });
      return;
    }

    const [maxOrder] = await db
      .select({ max: sql<number>`COALESCE(MAX(${lessonsTable.sortOrder}), -1)` })
      .from(lessonsTable)
      .where(eq(lessonsTable.moduleId, targetModuleId));

    let nextOrder = (maxOrder?.max ?? -1) + 1;

    const moved = [];
    for (const lessonId of lessonIds) {
      const [updated] = await db.update(lessonsTable)
        .set({ moduleId: targetModuleId, sortOrder: nextOrder++ })
        .where(eq(lessonsTable.id, lessonId))
        .returning();

      if (updated) moved.push(updated);
    }

    res.json({ moved });
  } catch (error) {
    console.error("[Admin] Error bulk moving:", error);
    res.status(500).json({ error: "Failed to bulk move lessons" });
  }
});

router.get("/admin/content/export", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const tracks = await db.select().from(tracksTable).orderBy(asc(tracksTable.sortOrder));

    const exportData = [];
    for (const track of tracks) {
      const modules = await db.select().from(modulesTable)
        .where(eq(modulesTable.trackId, track.id))
        .orderBy(asc(modulesTable.sortOrder));

      const moduleData = [];
      for (const mod of modules) {
        const lessons = await db.select().from(lessonsTable)
          .where(eq(lessonsTable.moduleId, mod.id))
          .orderBy(asc(lessonsTable.sortOrder));

        moduleData.push({
          ...mod,
          lessons,
        });
      }

      exportData.push({
        ...track,
        modules: moduleData,
      });
    }

    res.setHeader("Content-Disposition", "attachment; filename=training-content-export.json");
    res.json({
      exportedAt: new Date().toISOString(),
      version: 1,
      tracks: exportData,
    });
  } catch (error) {
    console.error("[Admin] Error exporting content:", error);
    res.status(500).json({ error: "Failed to export content" });
  }
});

router.post("/admin/content/import", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { tracks: importTracks } = req.body;
    if (!Array.isArray(importTracks)) {
      res.status(400).json({ error: "tracks must be an array" });
      return;
    }

    const created = { tracks: 0, modules: 0, lessons: 0 };

    for (const trackData of importTracks) {
      const { modules: modulesData, id: _trackId, ...trackFields } = trackData;

      const [newTrack] = await db.insert(tracksTable).values({
        title: trackFields.title,
        description: trackFields.description,
        requiredEntitlement: trackFields.requiredEntitlement || "content:frontend",
        sortOrder: trackFields.sortOrder || 0,
        status: "draft",
      }).returning();
      created.tracks++;

      if (Array.isArray(modulesData)) {
        for (const modData of modulesData) {
          const { lessons: lessonsData, id: _modId, trackId: _tid, ...modFields } = modData;

          const [newModule] = await db.insert(modulesTable).values({
            trackId: newTrack.id,
            title: modFields.title,
            description: modFields.description,
            sortOrder: modFields.sortOrder || 0,
          }).returning();
          created.modules++;

          if (Array.isArray(lessonsData)) {
            for (const lessonData of lessonsData) {
              const { id: _lid, moduleId: _mid, ...lessonFields } = lessonData;

              await db.insert(lessonsTable).values({
                moduleId: newModule.id,
                title: lessonFields.title,
                description: lessonFields.description,
                videoUrl: lessonFields.videoUrl || null,
                contentType: lessonFields.contentType || "video",
                textContent: lessonFields.textContent || null,
                actionItems: lessonFields.actionItems || null,
                durationMinutes: lessonFields.durationMinutes || 10,
                requiredEntitlement: lessonFields.requiredEntitlement || "content:frontend",
                sortOrder: lessonFields.sortOrder || 0,
                status: "draft",
              });
              created.lessons++;
            }
          }
        }
      }
    }

    res.status(201).json({ imported: created });
  } catch (error) {
    console.error("[Admin] Error importing content:", error);
    res.status(500).json({ error: "Failed to import content" });
  }
});

export default router;
