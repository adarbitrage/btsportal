import { Router, type Request, type Response } from "express";
import { db, vaultCollectionsTable, vaultResourcesTable, vaultFavoritesTable, vaultResourceRelationsTable } from "@workspace/db";
import { eq, and, sql, desc, asc, ilike, count, inArray } from "drizzle-orm";
import { getUserEntitlements } from "../lib/entitlements";

const router = Router();

router.get("/vault/collections", async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const entitlements = await getUserEntitlements(req.userId);

    const collections = await db
      .select({
        id: vaultCollectionsTable.id,
        name: vaultCollectionsTable.name,
        slug: vaultCollectionsTable.slug,
        description: vaultCollectionsTable.description,
        icon: vaultCollectionsTable.icon,
        parentId: vaultCollectionsTable.parentId,
        requiredEntitlement: vaultCollectionsTable.requiredEntitlement,
        sortOrder: vaultCollectionsTable.sortOrder,
      })
      .from(vaultCollectionsTable)
      .where(eq(vaultCollectionsTable.isActive, true))
      .orderBy(asc(vaultCollectionsTable.sortOrder));

    const resourceCounts = await db
      .select({
        collectionId: vaultResourcesTable.collectionId,
        count: count(),
      })
      .from(vaultResourcesTable)
      .groupBy(vaultResourcesTable.collectionId);

    const countMap: Record<number, number> = {};
    for (const rc of resourceCounts) {
      countMap[rc.collectionId] = rc.count;
    }

    const result = collections.map(c => ({
      ...c,
      resourceCount: countMap[c.id] || 0,
      isAccessible: entitlements.has(c.requiredEntitlement),
    }));

    res.json(result);
  } catch (error) {
    console.error("[Vault] Error listing collections:", error);
    res.status(500).json({ error: "Failed to list collections" });
  }
});

router.get("/vault/collections/:slug", async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { slug } = req.params;
    const entitlements = await getUserEntitlements(req.userId);

    const [collection] = await db
      .select()
      .from(vaultCollectionsTable)
      .where(and(eq(vaultCollectionsTable.slug, slug), eq(vaultCollectionsTable.isActive, true)));

    if (!collection) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }

    const isAccessible = entitlements.has(collection.requiredEntitlement);

    const subCollections = await db
      .select()
      .from(vaultCollectionsTable)
      .where(and(eq(vaultCollectionsTable.parentId, collection.id), eq(vaultCollectionsTable.isActive, true)))
      .orderBy(asc(vaultCollectionsTable.sortOrder));

    const collectionIds = [collection.id, ...subCollections.map(s => s.id)];

    let resources: any[] = [];
    if (isAccessible) {
      const { search, type, sort } = req.query;

      let query = db
        .select()
        .from(vaultResourcesTable)
        .where(inArray(vaultResourcesTable.collectionId, collectionIds))
        .$dynamic();

      resources = await query.orderBy(
        sort === "newest" ? desc(vaultResourcesTable.createdAt) :
        sort === "popular" ? desc(vaultResourcesTable.viewCount) :
        asc(vaultResourcesTable.sortOrder)
      );

      resources = resources.filter(r => entitlements.has(r.requiredEntitlement));

      if (search && typeof search === "string" && search.trim()) {
        const searchTerm = search.trim().toLowerCase();
        resources = resources.filter(r =>
          r.title.toLowerCase().includes(searchTerm) ||
          r.description.toLowerCase().includes(searchTerm)
        );
      }

      if (type && typeof type === "string" && type !== "all") {
        resources = resources.filter(r => r.type === type);
      }
    }

    const favorites = await db
      .select({ resourceId: vaultFavoritesTable.resourceId })
      .from(vaultFavoritesTable)
      .where(eq(vaultFavoritesTable.userId, req.userId));
    const favoriteSet = new Set(favorites.map(f => f.resourceId));

    res.json({
      collection: {
        ...collection,
        isAccessible,
      },
      subCollections: subCollections.map(sc => ({
        ...sc,
        isAccessible: entitlements.has(sc.requiredEntitlement),
      })),
      resources: resources.map(r => ({
        ...r,
        tags: typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags,
        isFavorited: favoriteSet.has(r.id),
      })),
    });
  } catch (error) {
    console.error("[Vault] Error getting collection:", error);
    res.status(500).json({ error: "Failed to get collection" });
  }
});

router.get("/vault/resources", async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const entitlements = await getUserEntitlements(req.userId);
    const { search, type, collection, sort, favorites: favoritesOnly, page = "1", limit = "20" } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let allResources = await db
      .select({
        id: vaultResourcesTable.id,
        collectionId: vaultResourcesTable.collectionId,
        title: vaultResourcesTable.title,
        slug: vaultResourcesTable.slug,
        description: vaultResourcesTable.description,
        type: vaultResourcesTable.type,
        fileType: vaultResourcesTable.fileType,
        fileSize: vaultResourcesTable.fileSize,
        thumbnailUrl: vaultResourcesTable.thumbnailUrl,
        tags: vaultResourcesTable.tags,
        isFeatured: vaultResourcesTable.isFeatured,
        requiredEntitlement: vaultResourcesTable.requiredEntitlement,
        viewCount: vaultResourcesTable.viewCount,
        downloadCount: vaultResourcesTable.downloadCount,
        createdAt: vaultResourcesTable.createdAt,
        collectionName: vaultCollectionsTable.name,
        collectionSlug: vaultCollectionsTable.slug,
      })
      .from(vaultResourcesTable)
      .innerJoin(vaultCollectionsTable, eq(vaultResourcesTable.collectionId, vaultCollectionsTable.id))
      .orderBy(
        sort === "newest" ? desc(vaultResourcesTable.createdAt) :
        sort === "popular" ? desc(vaultResourcesTable.viewCount) :
        sort === "az" ? asc(vaultResourcesTable.title) :
        desc(vaultResourcesTable.isFeatured)
      );

    allResources = allResources.filter(r => entitlements.has(r.requiredEntitlement));

    if (search && typeof search === "string" && search.trim()) {
      const searchTerm = search.trim().toLowerCase();
      allResources = allResources.filter(r =>
        r.title.toLowerCase().includes(searchTerm) ||
        r.description.toLowerCase().includes(searchTerm)
      );
    }

    if (type && typeof type === "string" && type !== "all") {
      allResources = allResources.filter(r => r.type === type);
    }

    if (collection && typeof collection === "string") {
      allResources = allResources.filter(r => r.collectionSlug === collection);
    }

    const userFavorites = await db
      .select({ resourceId: vaultFavoritesTable.resourceId })
      .from(vaultFavoritesTable)
      .where(eq(vaultFavoritesTable.userId, req.userId));
    const favoriteSet = new Set(userFavorites.map(f => f.resourceId));

    if (favoritesOnly === "true") {
      allResources = allResources.filter(r => favoriteSet.has(r.id));
    }

    const total = allResources.length;
    const paginatedResources = allResources.slice(offset, offset + limitNum);

    res.json({
      resources: paginatedResources.map(r => ({
        ...r,
        tags: typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags,
        isFavorited: favoriteSet.has(r.id),
      })),
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error("[Vault] Error listing resources:", error);
    res.status(500).json({ error: "Failed to list resources" });
  }
});

router.get("/vault/resources/featured", async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const entitlements = await getUserEntitlements(req.userId);

    const featured = await db
      .select({
        id: vaultResourcesTable.id,
        collectionId: vaultResourcesTable.collectionId,
        title: vaultResourcesTable.title,
        slug: vaultResourcesTable.slug,
        description: vaultResourcesTable.description,
        type: vaultResourcesTable.type,
        fileType: vaultResourcesTable.fileType,
        tags: vaultResourcesTable.tags,
        isFeatured: vaultResourcesTable.isFeatured,
        requiredEntitlement: vaultResourcesTable.requiredEntitlement,
        viewCount: vaultResourcesTable.viewCount,
        createdAt: vaultResourcesTable.createdAt,
        collectionName: vaultCollectionsTable.name,
        collectionSlug: vaultCollectionsTable.slug,
      })
      .from(vaultResourcesTable)
      .innerJoin(vaultCollectionsTable, eq(vaultResourcesTable.collectionId, vaultCollectionsTable.id))
      .where(eq(vaultResourcesTable.isFeatured, true))
      .orderBy(desc(vaultResourcesTable.createdAt))
      .limit(6);

    const userFavorites = await db
      .select({ resourceId: vaultFavoritesTable.resourceId })
      .from(vaultFavoritesTable)
      .where(eq(vaultFavoritesTable.userId, req.userId));
    const favoriteSet = new Set(userFavorites.map(f => f.resourceId));

    res.json(featured
      .filter(r => entitlements.has(r.requiredEntitlement))
      .map(r => ({
        ...r,
        tags: typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags,
        isFavorited: favoriteSet.has(r.id),
      }))
    );
  } catch (error) {
    console.error("[Vault] Error listing featured resources:", error);
    res.status(500).json({ error: "Failed to list featured resources" });
  }
});

router.get("/vault/resources/recent", async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const entitlements = await getUserEntitlements(req.userId);

    const recent = await db
      .select({
        id: vaultResourcesTable.id,
        collectionId: vaultResourcesTable.collectionId,
        title: vaultResourcesTable.title,
        slug: vaultResourcesTable.slug,
        description: vaultResourcesTable.description,
        type: vaultResourcesTable.type,
        fileType: vaultResourcesTable.fileType,
        tags: vaultResourcesTable.tags,
        requiredEntitlement: vaultResourcesTable.requiredEntitlement,
        createdAt: vaultResourcesTable.createdAt,
        collectionName: vaultCollectionsTable.name,
        collectionSlug: vaultCollectionsTable.slug,
      })
      .from(vaultResourcesTable)
      .innerJoin(vaultCollectionsTable, eq(vaultResourcesTable.collectionId, vaultCollectionsTable.id))
      .orderBy(desc(vaultResourcesTable.createdAt))
      .limit(10);

    const userFavorites = await db
      .select({ resourceId: vaultFavoritesTable.resourceId })
      .from(vaultFavoritesTable)
      .where(eq(vaultFavoritesTable.userId, req.userId));
    const favoriteSet = new Set(userFavorites.map(f => f.resourceId));

    res.json(recent
      .filter(r => entitlements.has(r.requiredEntitlement))
      .map(r => ({
        ...r,
        tags: typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags,
        isFavorited: favoriteSet.has(r.id),
      }))
    );
  } catch (error) {
    console.error("[Vault] Error listing recent resources:", error);
    res.status(500).json({ error: "Failed to list recent resources" });
  }
});

router.get("/vault/resources/:id", async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid resource ID" });
      return;
    }

    const entitlements = await getUserEntitlements(req.userId);

    const [resource] = await db
      .select({
        id: vaultResourcesTable.id,
        collectionId: vaultResourcesTable.collectionId,
        title: vaultResourcesTable.title,
        slug: vaultResourcesTable.slug,
        description: vaultResourcesTable.description,
        type: vaultResourcesTable.type,
        fileUrl: vaultResourcesTable.fileUrl,
        fileSize: vaultResourcesTable.fileSize,
        fileType: vaultResourcesTable.fileType,
        externalUrl: vaultResourcesTable.externalUrl,
        videoUrl: vaultResourcesTable.videoUrl,
        markdownContent: vaultResourcesTable.markdownContent,
        thumbnailUrl: vaultResourcesTable.thumbnailUrl,
        tags: vaultResourcesTable.tags,
        isFeatured: vaultResourcesTable.isFeatured,
        requiredEntitlement: vaultResourcesTable.requiredEntitlement,
        viewCount: vaultResourcesTable.viewCount,
        downloadCount: vaultResourcesTable.downloadCount,
        createdAt: vaultResourcesTable.createdAt,
        collectionName: vaultCollectionsTable.name,
        collectionSlug: vaultCollectionsTable.slug,
      })
      .from(vaultResourcesTable)
      .innerJoin(vaultCollectionsTable, eq(vaultResourcesTable.collectionId, vaultCollectionsTable.id))
      .where(eq(vaultResourcesTable.id, id));

    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    if (!entitlements.has(resource.requiredEntitlement)) {
      res.status(403).json({ error: "You do not have access to this resource. Upgrade your plan to unlock it." });
      return;
    }

    await db.update(vaultResourcesTable)
      .set({ viewCount: sql`${vaultResourcesTable.viewCount} + 1` })
      .where(eq(vaultResourcesTable.id, id));

    const relatedRows = await db
      .select({ relatedResourceId: vaultResourceRelationsTable.relatedResourceId })
      .from(vaultResourceRelationsTable)
      .where(eq(vaultResourceRelationsTable.resourceId, id));

    let relatedResources: any[] = [];
    if (relatedRows.length > 0) {
      const allRelated = await db
        .select({
          id: vaultResourcesTable.id,
          title: vaultResourcesTable.title,
          slug: vaultResourcesTable.slug,
          description: vaultResourcesTable.description,
          type: vaultResourcesTable.type,
          requiredEntitlement: vaultResourcesTable.requiredEntitlement,
          collectionName: vaultCollectionsTable.name,
          collectionSlug: vaultCollectionsTable.slug,
        })
        .from(vaultResourcesTable)
        .innerJoin(vaultCollectionsTable, eq(vaultResourcesTable.collectionId, vaultCollectionsTable.id))
        .where(inArray(vaultResourcesTable.id, relatedRows.map(r => r.relatedResourceId)));
      relatedResources = allRelated
        .filter(r => entitlements.has(r.requiredEntitlement))
        .map(({ requiredEntitlement, ...rest }) => rest);
    }

    const [fav] = await db
      .select()
      .from(vaultFavoritesTable)
      .where(and(eq(vaultFavoritesTable.userId, req.userId), eq(vaultFavoritesTable.resourceId, id)));

    res.json({
      ...resource,
      tags: typeof resource.tags === "string" ? JSON.parse(resource.tags) : resource.tags,
      isFavorited: !!fav,
      relatedResources,
    });
  } catch (error) {
    console.error("[Vault] Error getting resource:", error);
    res.status(500).json({ error: "Failed to get resource" });
  }
});

router.post("/vault/resources/:id/favorite", async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const resourceId = parseInt(req.params.id, 10);
    if (isNaN(resourceId)) {
      res.status(400).json({ error: "Invalid resource ID" });
      return;
    }

    const entitlements = await getUserEntitlements(req.userId);

    const [resource] = await db
      .select({ requiredEntitlement: vaultResourcesTable.requiredEntitlement })
      .from(vaultResourcesTable)
      .where(eq(vaultResourcesTable.id, resourceId));

    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    if (!entitlements.has(resource.requiredEntitlement)) {
      res.status(403).json({ error: "You do not have access to this resource" });
      return;
    }

    const [existing] = await db
      .select()
      .from(vaultFavoritesTable)
      .where(and(eq(vaultFavoritesTable.userId, req.userId), eq(vaultFavoritesTable.resourceId, resourceId)));

    if (existing) {
      await db.delete(vaultFavoritesTable).where(eq(vaultFavoritesTable.id, existing.id));
      res.json({ isFavorited: false });
    } else {
      await db.insert(vaultFavoritesTable).values({ userId: req.userId, resourceId });
      res.json({ isFavorited: true });
    }
  } catch (error) {
    console.error("[Vault] Error toggling favorite:", error);
    res.status(500).json({ error: "Failed to toggle favorite" });
  }
});

router.get("/vault/favorites", async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const entitlements = await getUserEntitlements(req.userId);

    const favorites = await db
      .select({
        id: vaultResourcesTable.id,
        title: vaultResourcesTable.title,
        slug: vaultResourcesTable.slug,
        description: vaultResourcesTable.description,
        type: vaultResourcesTable.type,
        fileType: vaultResourcesTable.fileType,
        tags: vaultResourcesTable.tags,
        requiredEntitlement: vaultResourcesTable.requiredEntitlement,
        createdAt: vaultResourcesTable.createdAt,
        collectionName: vaultCollectionsTable.name,
        collectionSlug: vaultCollectionsTable.slug,
        favoritedAt: vaultFavoritesTable.createdAt,
      })
      .from(vaultFavoritesTable)
      .innerJoin(vaultResourcesTable, eq(vaultFavoritesTable.resourceId, vaultResourcesTable.id))
      .innerJoin(vaultCollectionsTable, eq(vaultResourcesTable.collectionId, vaultCollectionsTable.id))
      .where(eq(vaultFavoritesTable.userId, req.userId))
      .orderBy(desc(vaultFavoritesTable.createdAt));

    const filtered = favorites.filter(r => entitlements.has(r.requiredEntitlement));

    res.json(filtered.map(r => ({
      ...r,
      tags: typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags,
      isFavorited: true,
    })));
  } catch (error) {
    console.error("[Vault] Error listing favorites:", error);
    res.status(500).json({ error: "Failed to list favorites" });
  }
});

router.get("/vault/search-suggestions", async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { q } = req.query;
    if (!q || typeof q !== "string" || q.trim().length < 2) {
      res.json([]);
      return;
    }

    const entitlements = await getUserEntitlements(req.userId);
    const searchTerm = q.trim().toLowerCase();

    const results = await db
      .select({
        id: vaultResourcesTable.id,
        title: vaultResourcesTable.title,
        type: vaultResourcesTable.type,
        requiredEntitlement: vaultResourcesTable.requiredEntitlement,
        collectionSlug: vaultCollectionsTable.slug,
      })
      .from(vaultResourcesTable)
      .innerJoin(vaultCollectionsTable, eq(vaultResourcesTable.collectionId, vaultCollectionsTable.id))
      .where(ilike(vaultResourcesTable.title, `%${searchTerm}%`))
      .limit(20);

    const filtered = results
      .filter(r => entitlements.has(r.requiredEntitlement))
      .slice(0, 8)
      .map(({ requiredEntitlement, ...rest }) => rest);

    res.json(filtered);
  } catch (error) {
    console.error("[Vault] Error getting search suggestions:", error);
    res.status(500).json({ error: "Failed to get search suggestions" });
  }
});

router.get("/vault/stats", async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const entitlements = await getUserEntitlements(req.userId);

    const allResources = await db
      .select({
        id: vaultResourcesTable.id,
        requiredEntitlement: vaultResourcesTable.requiredEntitlement,
      })
      .from(vaultResourcesTable);

    const accessibleIds = new Set(
      allResources.filter(r => entitlements.has(r.requiredEntitlement)).map(r => r.id)
    );

    const allFavorites = await db
      .select({ resourceId: vaultFavoritesTable.resourceId })
      .from(vaultFavoritesTable)
      .where(eq(vaultFavoritesTable.userId, req.userId));

    const accessibleFavCount = allFavorites.filter(f => accessibleIds.has(f.resourceId)).length;

    const recentAll = await db
      .select({
        id: vaultResourcesTable.id,
        title: vaultResourcesTable.title,
        slug: vaultResourcesTable.slug,
        type: vaultResourcesTable.type,
        requiredEntitlement: vaultResourcesTable.requiredEntitlement,
        createdAt: vaultResourcesTable.createdAt,
        collectionSlug: vaultCollectionsTable.slug,
      })
      .from(vaultResourcesTable)
      .innerJoin(vaultCollectionsTable, eq(vaultResourcesTable.collectionId, vaultCollectionsTable.id))
      .orderBy(desc(vaultResourcesTable.createdAt))
      .limit(20);

    const recentResources = recentAll
      .filter(r => entitlements.has(r.requiredEntitlement))
      .slice(0, 5)
      .map(({ requiredEntitlement, ...rest }) => rest);

    res.json({
      totalResources: accessibleIds.size,
      favoriteCount: accessibleFavCount,
      recentResources,
    });
  } catch (error) {
    console.error("[Vault] Error getting vault stats:", error);
    res.status(500).json({ error: "Failed to get vault stats" });
  }
});

router.post("/vault/resources/:id/download", async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid resource ID" });
      return;
    }

    const entitlements = await getUserEntitlements(req.userId);

    const [resource] = await db
      .select()
      .from(vaultResourcesTable)
      .where(eq(vaultResourcesTable.id, id));

    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    if (!entitlements.has(resource.requiredEntitlement)) {
      res.status(403).json({ error: "You do not have access to this resource. Upgrade your plan to unlock it." });
      return;
    }

    if (resource.type !== "file" || !resource.fileUrl) {
      res.status(400).json({ error: "This resource is not downloadable" });
      return;
    }

    await db.update(vaultResourcesTable)
      .set({ downloadCount: sql`${vaultResourcesTable.downloadCount} + 1` })
      .where(eq(vaultResourcesTable.id, id));

    res.json({
      downloadUrl: resource.fileUrl,
      fileName: resource.title,
      fileType: resource.fileType,
    });
  } catch (error) {
    console.error("[Vault] Error downloading resource:", error);
    res.status(500).json({ error: "Failed to download resource" });
  }
});

export default router;
