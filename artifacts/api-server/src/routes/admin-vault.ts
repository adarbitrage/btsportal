import { Router, type Request, type Response } from "express";
import {
  db,
  vaultCollectionsTable,
  vaultResourcesTable,
  vaultResourceDownloadsTable,
  vaultResourceFavoritesTable,
  vaultResourceRelationsTable,
  vaultResourceLessonRelationsTable,
  vaultSearchQueriesTable,
  lessonsTable,
} from "@workspace/db";
import { eq, desc, asc, sql, ilike, and, or, inArray, isNull, count } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();

router.get("/admin/vault/collections", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const collections = await db
      .select()
      .from(vaultCollectionsTable)
      .orderBy(asc(vaultCollectionsTable.sortOrder));
    res.json(collections);
  } catch (error) {
    console.error("[Admin Vault] Error listing collections:", error);
    res.status(500).json({ error: "Failed to list collections" });
  }
});

router.post("/admin/vault/collections", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, slug, description, icon, coverImageUrl, requiredEntitlement, parentId, sortOrder } = req.body;
    if (!name || !slug) {
      res.status(400).json({ error: "name and slug are required" });
      return;
    }
    const [collection] = await db.insert(vaultCollectionsTable).values({
      name,
      slug,
      description: description || null,
      icon: icon || null,
      coverImageUrl: coverImageUrl || null,
      requiredEntitlement: requiredEntitlement || "content:frontend",
      parentId: parentId || null,
      sortOrder: sortOrder ?? 0,
    }).returning();
    res.status(201).json(collection);
  } catch (error) {
    console.error("[Admin Vault] Error creating collection:", error);
    res.status(500).json({ error: "Failed to create collection" });
  }
});

router.patch("/admin/vault/collections/reorder", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) { res.status(400).json({ error: "orders must be an array" }); return; }
    for (const { id, sortOrder } of orders) {
      await db.update(vaultCollectionsTable).set({ sortOrder, updatedAt: new Date() }).where(eq(vaultCollectionsTable.id, id));
    }
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin Vault] Error reordering collections:", error);
    res.status(500).json({ error: "Failed to reorder collections" });
  }
});

router.patch("/admin/vault/collections/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const updates: any = { updatedAt: new Date() };
    const fields = ["name", "slug", "description", "icon", "coverImageUrl", "requiredEntitlement", "parentId", "sortOrder", "isActive"];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    const [updated] = await db.update(vaultCollectionsTable).set(updates).where(eq(vaultCollectionsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Collection not found" }); return; }
    res.json(updated);
  } catch (error) {
    console.error("[Admin Vault] Error updating collection:", error);
    res.status(500).json({ error: "Failed to update collection" });
  }
});

router.delete("/admin/vault/collections/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const resourceCount = await db.select({ count: count() }).from(vaultResourcesTable).where(eq(vaultResourcesTable.collectionId, id));
    if (resourceCount[0]?.count > 0) {
      res.status(400).json({ error: "Cannot delete collection with resources. Move or delete resources first." });
      return;
    }
    const childCount = await db.select({ count: count() }).from(vaultCollectionsTable).where(eq(vaultCollectionsTable.parentId, id));
    if (childCount[0]?.count > 0) {
      res.status(400).json({ error: "Cannot delete collection with sub-collections. Delete sub-collections first." });
      return;
    }
    const [deleted] = await db.delete(vaultCollectionsTable).where(eq(vaultCollectionsTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Collection not found" }); return; }
    res.json(deleted);
  } catch (error) {
    console.error("[Admin Vault] Error deleting collection:", error);
    res.status(500).json({ error: "Failed to delete collection" });
  }
});

router.get("/admin/vault/resources/search", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q) { res.json([]); return; }
    const results = await db.select({ id: vaultResourcesTable.id, title: vaultResourcesTable.title, resourceType: vaultResourcesTable.resourceType })
      .from(vaultResourcesTable)
      .where(ilike(vaultResourcesTable.title, `%${q as string}%`))
      .limit(20);
    res.json(results);
  } catch (error) {
    console.error("[Admin Vault] Error searching resources:", error);
    res.status(500).json({ error: "Failed to search resources" });
  }
});

router.get("/admin/vault/resources", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { type, collection, status, search, page = "1", limit = "25" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 25));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (type && type !== "all") conditions.push(eq(vaultResourcesTable.resourceType, type as string));
    if (status && status !== "all") conditions.push(eq(vaultResourcesTable.status, status as string));
    if (collection && collection !== "all") {
      const collId = parseInt(collection as string, 10);
      if (!isNaN(collId)) conditions.push(eq(vaultResourcesTable.collectionId, collId));
    }
    if (search) {
      const term = `%${search as string}%`;
      conditions.push(
        or(
          ilike(vaultResourcesTable.title, term),
          ilike(vaultResourcesTable.description, term)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [resources, totalResult] = await Promise.all([
      db.select({
        resource: vaultResourcesTable,
        collectionName: vaultCollectionsTable.name,
      })
        .from(vaultResourcesTable)
        .leftJoin(vaultCollectionsTable, eq(vaultResourcesTable.collectionId, vaultCollectionsTable.id))
        .where(whereClause)
        .orderBy(desc(vaultResourcesTable.updatedAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ count: count() }).from(vaultResourcesTable).where(whereClause),
    ]);

    res.json({
      resources: resources.map(r => ({ ...r.resource, collectionName: r.collectionName })),
      total: totalResult[0]?.count ?? 0,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error("[Admin Vault] Error listing resources:", error);
    res.status(500).json({ error: "Failed to list resources" });
  }
});

router.get("/admin/vault/resources/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [resource] = await db.select().from(vaultResourcesTable).where(eq(vaultResourcesTable.id, id));
    if (!resource) { res.status(404).json({ error: "Resource not found" }); return; }

    const [relatedResources, relatedLessons] = await Promise.all([
      db.select({
        relationId: vaultResourceRelationsTable.id,
        resourceId: vaultResourcesTable.id,
        title: vaultResourcesTable.title,
        resourceType: vaultResourcesTable.resourceType,
      })
        .from(vaultResourceRelationsTable)
        .innerJoin(vaultResourcesTable, eq(vaultResourceRelationsTable.relatedResourceId, vaultResourcesTable.id))
        .where(eq(vaultResourceRelationsTable.resourceId, id)),
      db.select({
        relationId: vaultResourceLessonRelationsTable.id,
        lessonId: lessonsTable.id,
        title: lessonsTable.title,
      })
        .from(vaultResourceLessonRelationsTable)
        .innerJoin(lessonsTable, eq(vaultResourceLessonRelationsTable.lessonId, lessonsTable.id))
        .where(eq(vaultResourceLessonRelationsTable.resourceId, id)),
    ]);

    res.json({ ...resource, relatedResources, relatedLessons });
  } catch (error) {
    console.error("[Admin Vault] Error getting resource:", error);
    res.status(500).json({ error: "Failed to get resource" });
  }
});

router.post("/admin/vault/resources", requireAdmin, async (req: Request, res: Response) => {
  try {
    const {
      title, description, longDescription, resourceType, collectionId,
      fileUrl, fileName, fileSize, fileType, previewImageUrl,
      contentHtml, externalUrl, videoUrl, tags,
      requiredEntitlement, isFeatured, isPinned, isNew, status,
      version, updateNote, sortOrder,
    } = req.body;

    if (!title) { res.status(400).json({ error: "title is required" }); return; }

    const [resource] = await db.insert(vaultResourcesTable).values({
      title,
      description: description || null,
      longDescription: longDescription || null,
      resourceType: resourceType || "document",
      collectionId: collectionId || null,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      fileSize: fileSize || null,
      fileType: fileType || null,
      previewImageUrl: previewImageUrl || null,
      contentHtml: contentHtml || null,
      externalUrl: externalUrl || null,
      videoUrl: videoUrl || null,
      tags: tags || [],
      requiredEntitlement: requiredEntitlement || "content:frontend",
      isFeatured: isFeatured || false,
      isPinned: isPinned || false,
      isNew: isNew !== undefined ? isNew : true,
      status: status || "draft",
      version: version || null,
      updateNote: updateNote || null,
      sortOrder: sortOrder ?? 0,
    }).returning();

    res.status(201).json(resource);
  } catch (error) {
    console.error("[Admin Vault] Error creating resource:", error);
    res.status(500).json({ error: "Failed to create resource" });
  }
});

router.patch("/admin/vault/resources/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const updates: any = { updatedAt: new Date() };
    const fields = [
      "title", "description", "longDescription", "resourceType", "collectionId",
      "fileUrl", "fileName", "fileSize", "fileType", "previewImageUrl",
      "contentHtml", "externalUrl", "videoUrl", "tags",
      "requiredEntitlement", "isFeatured", "isPinned", "isNew", "status",
      "version", "updateNote", "sortOrder",
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    const [updated] = await db.update(vaultResourcesTable).set(updates).where(eq(vaultResourcesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Resource not found" }); return; }
    res.json(updated);
  } catch (error) {
    console.error("[Admin Vault] Error updating resource:", error);
    res.status(500).json({ error: "Failed to update resource" });
  }
});

router.post("/admin/vault/resources/:id/duplicate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [original] = await db.select().from(vaultResourcesTable).where(eq(vaultResourcesTable.id, id));
    if (!original) { res.status(404).json({ error: "Resource not found" }); return; }

    const { id: _id, createdAt: _ca, updatedAt: _ua, downloadCount: _dc, favoriteCount: _fc, ...rest } = original;
    const [duplicate] = await db.insert(vaultResourcesTable).values({
      ...rest,
      title: `${original.title} (Copy)`,
      status: "draft",
    }).returning();

    res.status(201).json(duplicate);
  } catch (error) {
    console.error("[Admin Vault] Error duplicating resource:", error);
    res.status(500).json({ error: "Failed to duplicate resource" });
  }
});

router.patch("/admin/vault/resources/:id/archive", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [updated] = await db.update(vaultResourcesTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(vaultResourcesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Resource not found" }); return; }
    res.json(updated);
  } catch (error) {
    console.error("[Admin Vault] Error archiving resource:", error);
    res.status(500).json({ error: "Failed to archive resource" });
  }
});

router.post("/admin/vault/resources/:id/relations", requireAdmin, async (req: Request, res: Response) => {
  try {
    const resourceId = parseInt(req.params.id as string, 10);
    if (isNaN(resourceId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { relatedResourceId } = req.body;
    if (!relatedResourceId) { res.status(400).json({ error: "relatedResourceId is required" }); return; }

    const [relation] = await db.insert(vaultResourceRelationsTable).values({
      resourceId,
      relatedResourceId,
    }).returning();
    res.status(201).json(relation);
  } catch (error) {
    console.error("[Admin Vault] Error adding relation:", error);
    res.status(500).json({ error: "Failed to add relation" });
  }
});

router.delete("/admin/vault/resources/:id/relations/:relationId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const relationId = parseInt(req.params.relationId as string, 10);
    if (isNaN(relationId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [deleted] = await db.delete(vaultResourceRelationsTable).where(eq(vaultResourceRelationsTable.id, relationId)).returning();
    if (!deleted) { res.status(404).json({ error: "Relation not found" }); return; }
    res.json(deleted);
  } catch (error) {
    console.error("[Admin Vault] Error removing relation:", error);
    res.status(500).json({ error: "Failed to remove relation" });
  }
});

router.post("/admin/vault/resources/:id/lesson-relations", requireAdmin, async (req: Request, res: Response) => {
  try {
    const resourceId = parseInt(req.params.id as string, 10);
    if (isNaN(resourceId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { lessonId } = req.body;
    if (!lessonId) { res.status(400).json({ error: "lessonId is required" }); return; }

    const [relation] = await db.insert(vaultResourceLessonRelationsTable).values({
      resourceId,
      lessonId,
    }).returning();
    res.status(201).json(relation);
  } catch (error) {
    console.error("[Admin Vault] Error adding lesson relation:", error);
    res.status(500).json({ error: "Failed to add lesson relation" });
  }
});

router.delete("/admin/vault/resources/:id/lesson-relations/:relationId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const relationId = parseInt(req.params.relationId as string, 10);
    if (isNaN(relationId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [deleted] = await db.delete(vaultResourceLessonRelationsTable).where(eq(vaultResourceLessonRelationsTable.id, relationId)).returning();
    if (!deleted) { res.status(404).json({ error: "Relation not found" }); return; }
    res.json(deleted);
  } catch (error) {
    console.error("[Admin Vault] Error removing lesson relation:", error);
    res.status(500).json({ error: "Failed to remove lesson relation" });
  }
});

router.post("/admin/vault/upload-url", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const storageService = new ObjectStorageService();
    const uploadURL = await storageService.getObjectEntityUploadURL();
    const objectPath = storageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch (error) {
    console.error("[Admin Vault] Error generating upload URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.get("/admin/vault/lessons/search", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q) { res.json([]); return; }
    const results = await db.select({ id: lessonsTable.id, title: lessonsTable.title })
      .from(lessonsTable)
      .where(ilike(lessonsTable.title, `%${q as string}%`))
      .limit(20);
    res.json(results);
  } catch (error) {
    console.error("[Admin Vault] Error searching lessons:", error);
    res.status(500).json({ error: "Failed to search lessons" });
  }
});

router.get("/admin/vault/tags", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const resources = await db.select({ tags: vaultResourcesTable.tags }).from(vaultResourcesTable);
    const tagSet = new Set<string>();
    for (const r of resources) {
      if (Array.isArray(r.tags)) {
        for (const t of r.tags) tagSet.add(t);
      }
    }
    res.json(Array.from(tagSet).sort());
  } catch (error) {
    console.error("[Admin Vault] Error listing tags:", error);
    res.status(500).json({ error: "Failed to list tags" });
  }
});

router.get("/admin/vault/analytics", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [
      mostDownloaded,
      mostFavorited,
      zeroDownloads,
      downloadTrends,
      searchGaps,
      totalResources,
      totalCollections,
    ] = await Promise.all([
      db.select({
        id: vaultResourcesTable.id,
        title: vaultResourcesTable.title,
        resourceType: vaultResourcesTable.resourceType,
        downloadCount: vaultResourcesTable.downloadCount,
        collectionName: vaultCollectionsTable.name,
      })
        .from(vaultResourcesTable)
        .leftJoin(vaultCollectionsTable, eq(vaultResourcesTable.collectionId, vaultCollectionsTable.id))
        .where(eq(vaultResourcesTable.status, "published"))
        .orderBy(desc(vaultResourcesTable.downloadCount))
        .limit(10),

      db.select({
        id: vaultResourcesTable.id,
        title: vaultResourcesTable.title,
        resourceType: vaultResourcesTable.resourceType,
        favoriteCount: vaultResourcesTable.favoriteCount,
        collectionName: vaultCollectionsTable.name,
      })
        .from(vaultResourcesTable)
        .leftJoin(vaultCollectionsTable, eq(vaultResourcesTable.collectionId, vaultCollectionsTable.id))
        .where(eq(vaultResourcesTable.status, "published"))
        .orderBy(desc(vaultResourcesTable.favoriteCount))
        .limit(10),

      db.select({
        id: vaultResourcesTable.id,
        title: vaultResourcesTable.title,
        resourceType: vaultResourcesTable.resourceType,
        createdAt: vaultResourcesTable.createdAt,
        collectionName: vaultCollectionsTable.name,
      })
        .from(vaultResourcesTable)
        .leftJoin(vaultCollectionsTable, eq(vaultResourcesTable.collectionId, vaultCollectionsTable.id))
        .where(and(
          eq(vaultResourcesTable.status, "published"),
          eq(vaultResourcesTable.downloadCount, 0),
          eq(vaultResourcesTable.favoriteCount, 0),
        ))
        .orderBy(asc(vaultResourcesTable.createdAt))
        .limit(20),

      db.select({
        date: sql<string>`DATE(${vaultResourceDownloadsTable.downloadedAt})`,
        downloads: count(),
      })
        .from(vaultResourceDownloadsTable)
        .where(sql`${vaultResourceDownloadsTable.downloadedAt} >= NOW() - INTERVAL '30 days'`)
        .groupBy(sql`DATE(${vaultResourceDownloadsTable.downloadedAt})`)
        .orderBy(sql`DATE(${vaultResourceDownloadsTable.downloadedAt})`),

      db.select({
        query: vaultSearchQueriesTable.query,
        searchCount: count(),
        avgResults: sql<number>`AVG(${vaultSearchQueriesTable.resultCount})::int`,
      })
        .from(vaultSearchQueriesTable)
        .where(sql`${vaultSearchQueriesTable.resultCount} = 0`)
        .groupBy(vaultSearchQueriesTable.query)
        .orderBy(desc(count()))
        .limit(20),

      db.select({ count: count() }).from(vaultResourcesTable),
      db.select({ count: count() }).from(vaultCollectionsTable),
    ]);

    res.json({
      mostDownloaded,
      mostFavorited,
      zeroDownloads,
      downloadTrends,
      searchGaps,
      totalResources: totalResources[0]?.count ?? 0,
      totalCollections: totalCollections[0]?.count ?? 0,
    });
  } catch (error) {
    console.error("[Admin Vault] Error fetching analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

export default router;
