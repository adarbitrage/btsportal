import { Router, type Request, type Response } from "express";
import { db, toolsTable, toolCategoriesTable, toolUsageLogTable, usersTable, userProductsTable, productsTable } from "@workspace/db";
import { eq, sql, asc, desc, and, gte, lt, count, countDistinct, or, isNull } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";

interface CategoryCreateBody {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  sortOrder?: number;
}

interface CategoryUpdateBody {
  name?: string;
  slug?: string;
  description?: string;
  icon?: string;
  sortOrder?: number;
  isActive?: boolean;
}

interface ToolCreateBody {
  slug: string;
  name: string;
  shortDescription: string;
  longDescription?: string;
  icon?: string;
  categoryId: number;
  type?: string;
  requiredEntitlement?: string;
  config?: Record<string, unknown>;
  isFeatured?: number;
  isNew?: boolean;
  isBeta?: boolean;
  status?: string;
  badge?: string;
  sortOrder?: number;
  videoTutorialUrl?: string;
  helpDocUrl?: string;
  rateLimitPerDay?: number;
}

interface ToolUpdateBody {
  slug?: string;
  name?: string;
  shortDescription?: string;
  longDescription?: string;
  icon?: string;
  categoryId?: number;
  type?: string;
  requiredEntitlement?: string;
  config?: Record<string, unknown>;
  isFeatured?: number;
  isNew?: boolean;
  isBeta?: boolean;
  status?: string;
  badge?: string;
  sortOrder?: number;
  videoTutorialUrl?: string;
  helpDocUrl?: string;
  rateLimitPerDay?: number;
}

const router = Router();

router.get("/admin/tool-categories", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const categories = await db.select().from(toolCategoriesTable).orderBy(asc(toolCategoriesTable.sortOrder));
    res.json(categories);
  } catch (error) {
    console.error("[Admin] Error listing tool categories:", error);
    res.status(500).json({ error: "Failed to list tool categories" });
  }
});

router.post("/admin/tool-categories", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, slug, description, icon, sortOrder } = req.body as CategoryCreateBody;
    if (!name || !slug) {
      res.status(400).json({ error: "name and slug are required" });
      return;
    }

    const [maxOrder] = await db
      .select({ max: sql<number>`COALESCE(MAX(${toolCategoriesTable.sortOrder}), -1)` })
      .from(toolCategoriesTable);

    const [category] = await db.insert(toolCategoriesTable).values({
      name,
      slug,
      description: description || null,
      icon: icon || null,
      sortOrder: sortOrder ?? (maxOrder?.max ?? -1) + 1,
    }).returning();

    res.status(201).json(category);
  } catch (error) {
    console.error("[Admin] Error creating tool category:", error);
    res.status(500).json({ error: "Failed to create tool category" });
  }
});

router.put("/admin/tool-categories/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid category ID" });
      return;
    }

    const body = req.body as CategoryUpdateBody;
    const updates: Partial<typeof toolCategoriesTable.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.slug !== undefined) updates.slug = body.slug;
    if (body.description !== undefined) updates.description = body.description;
    if (body.icon !== undefined) updates.icon = body.icon;
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db.update(toolCategoriesTable).set(updates).where(eq(toolCategoriesTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating tool category:", error);
    res.status(500).json({ error: "Failed to update tool category" });
  }
});

router.delete("/admin/tool-categories/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid category ID" });
      return;
    }

    const toolsUsingCategory = await db.select({ count: count() }).from(toolsTable).where(eq(toolsTable.categoryId, id));
    if (toolsUsingCategory[0]?.count > 0) {
      res.status(400).json({ error: "Cannot delete category that has tools assigned. Reassign or remove tools first." });
      return;
    }

    const [deleted] = await db.delete(toolCategoriesTable).where(eq(toolCategoriesTable.id, id)).returning();
    if (!deleted) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    res.json({ message: "Category deleted" });
  } catch (error) {
    console.error("[Admin] Error deleting tool category:", error);
    res.status(500).json({ error: "Failed to delete tool category" });
  }
});

router.get("/admin/tools", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const tools = await db
      .select({
        id: toolsTable.id,
        slug: toolsTable.slug,
        name: toolsTable.name,
        shortDescription: toolsTable.shortDescription,
        longDescription: toolsTable.longDescription,
        icon: toolsTable.icon,
        categoryId: toolsTable.categoryId,
        categoryName: toolCategoriesTable.name,
        type: toolsTable.type,
        requiredEntitlement: toolsTable.requiredEntitlement,
        config: toolsTable.config,
        isFeatured: toolsTable.isFeatured,
        isNew: toolsTable.isNew,
        isBeta: toolsTable.isBeta,
        status: toolsTable.status,
        badge: toolsTable.badge,
        totalLaunches: toolsTable.totalLaunches,
        sortOrder: toolsTable.sortOrder,
        videoTutorialUrl: toolsTable.videoTutorialUrl,
        helpDocUrl: toolsTable.helpDocUrl,
        rateLimitPerDay: toolsTable.rateLimitPerDay,
        createdAt: toolsTable.createdAt,
        updatedAt: toolsTable.updatedAt,
      })
      .from(toolsTable)
      .leftJoin(toolCategoriesTable, eq(toolsTable.categoryId, toolCategoriesTable.id))
      .orderBy(asc(toolsTable.sortOrder));

    res.json(tools);
  } catch (error) {
    console.error("[Admin] Error listing tools:", error);
    res.status(500).json({ error: "Failed to list tools" });
  }
});

router.post("/admin/tools", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as ToolCreateBody;

    if (!body.slug || !body.name || !body.shortDescription || !body.categoryId) {
      res.status(400).json({ error: "slug, name, shortDescription, and categoryId are required" });
      return;
    }

    const [maxOrder] = await db
      .select({ max: sql<number>`COALESCE(MAX(${toolsTable.sortOrder}), -1)` })
      .from(toolsTable);

    const [tool] = await db.insert(toolsTable).values({
      slug: body.slug,
      name: body.name,
      shortDescription: body.shortDescription,
      longDescription: body.longDescription || null,
      icon: body.icon || null,
      categoryId: body.categoryId,
      type: body.type || "builtin",
      requiredEntitlement: body.requiredEntitlement || "software:base",
      config: body.config || {},
      isFeatured: body.isFeatured ?? 0,
      isNew: body.isNew ?? false,
      isBeta: body.isBeta ?? false,
      status: body.status || "active",
      badge: body.badge || null,
      sortOrder: body.sortOrder ?? (maxOrder?.max ?? -1) + 1,
      videoTutorialUrl: body.videoTutorialUrl || null,
      helpDocUrl: body.helpDocUrl || null,
      rateLimitPerDay: body.rateLimitPerDay ?? null,
    }).returning();

    res.status(201).json(tool);
  } catch (error) {
    console.error("[Admin] Error creating tool:", error);
    res.status(500).json({ error: "Failed to create tool" });
  }
});

router.put("/admin/tools/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid tool ID" });
      return;
    }

    const body = req.body as ToolUpdateBody;
    const updates: Partial<typeof toolsTable.$inferInsert> = {};
    if (body.slug !== undefined) updates.slug = body.slug;
    if (body.name !== undefined) updates.name = body.name;
    if (body.shortDescription !== undefined) updates.shortDescription = body.shortDescription;
    if (body.longDescription !== undefined) updates.longDescription = body.longDescription;
    if (body.icon !== undefined) updates.icon = body.icon;
    if (body.categoryId !== undefined) updates.categoryId = body.categoryId;
    if (body.type !== undefined) updates.type = body.type;
    if (body.requiredEntitlement !== undefined) updates.requiredEntitlement = body.requiredEntitlement;
    if (body.config !== undefined) updates.config = body.config;
    if (body.isFeatured !== undefined) updates.isFeatured = body.isFeatured;
    if (body.isNew !== undefined) updates.isNew = body.isNew;
    if (body.isBeta !== undefined) updates.isBeta = body.isBeta;
    if (body.status !== undefined) updates.status = body.status;
    if (body.badge !== undefined) updates.badge = body.badge;
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
    if (body.videoTutorialUrl !== undefined) updates.videoTutorialUrl = body.videoTutorialUrl;
    if (body.helpDocUrl !== undefined) updates.helpDocUrl = body.helpDocUrl;
    if (body.rateLimitPerDay !== undefined) updates.rateLimitPerDay = body.rateLimitPerDay;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db.update(toolsTable).set(updates).where(eq(toolsTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Tool not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating tool:", error);
    res.status(500).json({ error: "Failed to update tool" });
  }
});

router.delete("/admin/tools/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid tool ID" });
      return;
    }

    const [deleted] = await db.delete(toolsTable).where(eq(toolsTable.id, id)).returning();
    if (!deleted) {
      res.status(404).json({ error: "Tool not found" });
      return;
    }

    res.json({ message: "Tool deleted" });
  } catch (error: unknown) {
    const pgError = error as { code?: string };
    if (pgError.code === "23503") {
      res.status(409).json({ error: "Cannot delete tool with existing usage history. Deactivate it instead." });
      return;
    }
    console.error("[Admin] Error deleting tool:", error);
    res.status(500).json({ error: "Failed to delete tool" });
  }
});

router.patch("/admin/tools/:id/activate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid tool ID" });
      return;
    }

    const [updated] = await db.update(toolsTable).set({ status: "active" }).where(eq(toolsTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Tool not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error activating tool:", error);
    res.status(500).json({ error: "Failed to activate tool" });
  }
});

router.patch("/admin/tools/:id/deactivate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid tool ID" });
      return;
    }

    const [updated] = await db.update(toolsTable).set({ status: "inactive" }).where(eq(toolsTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Tool not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error deactivating tool:", error);
    res.status(500).json({ error: "Failed to deactivate tool" });
  }
});

router.get("/admin/tools/analytics", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const prevWeekStart = new Date(todayStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 14);
    const monthStart = new Date(todayStart);
    monthStart.setDate(monthStart.getDate() - 30);
    const prevMonthStart = new Date(todayStart);
    prevMonthStart.setDate(prevMonthStart.getDate() - 60);

    const [totalOpensToday] = await db
      .select({ count: count() })
      .from(toolUsageLogTable)
      .where(and(eq(toolUsageLogTable.action, "open"), gte(toolUsageLogTable.createdAt, todayStart)));

    const [totalOpensYesterday] = await db
      .select({ count: count() })
      .from(toolUsageLogTable)
      .where(and(eq(toolUsageLogTable.action, "open"), gte(toolUsageLogTable.createdAt, yesterdayStart), lt(toolUsageLogTable.createdAt, todayStart)));

    const [totalOpensWeek] = await db
      .select({ count: count() })
      .from(toolUsageLogTable)
      .where(and(eq(toolUsageLogTable.action, "open"), gte(toolUsageLogTable.createdAt, weekStart)));

    const [totalOpensPrevWeek] = await db
      .select({ count: count() })
      .from(toolUsageLogTable)
      .where(and(eq(toolUsageLogTable.action, "open"), gte(toolUsageLogTable.createdAt, prevWeekStart), lt(toolUsageLogTable.createdAt, weekStart)));

    const [totalOpensMonth] = await db
      .select({ count: count() })
      .from(toolUsageLogTable)
      .where(and(eq(toolUsageLogTable.action, "open"), gte(toolUsageLogTable.createdAt, monthStart)));

    const [totalOpensPrevMonth] = await db
      .select({ count: count() })
      .from(toolUsageLogTable)
      .where(and(eq(toolUsageLogTable.action, "open"), gte(toolUsageLogTable.createdAt, prevMonthStart), lt(toolUsageLogTable.createdAt, monthStart)));

    function computeTrend(current: number, previous: number): number {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    }

    const popularTools = await db
      .select({
        toolId: toolUsageLogTable.toolId,
        toolName: toolsTable.name,
        toolSlug: toolsTable.slug,
        opens: count(),
      })
      .from(toolUsageLogTable)
      .innerJoin(toolsTable, eq(toolUsageLogTable.toolId, toolsTable.id))
      .where(eq(toolUsageLogTable.action, "open"))
      .groupBy(toolUsageLogTable.toolId, toolsTable.name, toolsTable.slug)
      .orderBy(desc(count()))
      .limit(10);

    const usageByTier = await db
      .select({
        entitlementTier: toolUsageLogTable.entitlementTier,
        count: count(),
      })
      .from(toolUsageLogTable)
      .where(gte(toolUsageLogTable.createdAt, monthStart))
      .groupBy(toolUsageLogTable.entitlementTier);

    const aiStats = await db
      .select({
        totalGenerations: count(),
        totalTokens: sql<number>`COALESCE(SUM(${toolUsageLogTable.aiTokensUsed}), 0)`,
        totalCostCents: sql<number>`COALESCE(SUM(${toolUsageLogTable.aiCostCents}), 0)`,
      })
      .from(toolUsageLogTable)
      .where(and(
        sql`${toolUsageLogTable.action} IN ('generate', 'analyze')`,
        gte(toolUsageLogTable.createdAt, monthStart),
      ));

    const [totalUsersResult] = await db
      .select({ count: count() })
      .from(usersTable);
    const totalUsers = totalUsersResult?.count ?? 0;

    const toolAdoptionRaw = await db
      .select({
        toolId: toolUsageLogTable.toolId,
        toolName: toolsTable.name,
        requiredEntitlement: toolsTable.requiredEntitlement,
        uniqueUsers: countDistinct(toolUsageLogTable.userId),
      })
      .from(toolUsageLogTable)
      .innerJoin(toolsTable, eq(toolUsageLogTable.toolId, toolsTable.id))
      .where(gte(toolUsageLogTable.createdAt, monthStart))
      .groupBy(toolUsageLogTable.toolId, toolsTable.name, toolsTable.requiredEntitlement)
      .orderBy(desc(countDistinct(toolUsageLogTable.userId)));

    const eligibleUsersByEntitlement = new Map<string, number>();
    const entitlementKeys = [...new Set(toolAdoptionRaw.map((r) => r.requiredEntitlement))];
    for (const entKey of entitlementKeys) {
      const [result] = await db
        .select({ count: countDistinct(userProductsTable.userId) })
        .from(userProductsTable)
        .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
        .where(and(
          eq(userProductsTable.status, "active"),
          or(isNull(userProductsTable.expiresAt), gte(userProductsTable.expiresAt, now)),
          sql`${productsTable.entitlementKeys}::jsonb @> ${JSON.stringify([entKey])}::jsonb`,
        ));
      eligibleUsersByEntitlement.set(entKey, result?.count ?? 0);
    }

    const toolAdoption = toolAdoptionRaw.map((row) => {
      const eligible = eligibleUsersByEntitlement.get(row.requiredEntitlement) ?? totalUsers;
      return {
        toolId: row.toolId,
        toolName: row.toolName,
        uniqueUsers: row.uniqueUsers,
        adoptionRate: eligible > 0 ? Math.round((row.uniqueUsers / eligible) * 10000) / 100 : 0,
      };
    });

    const dailyUsage = await db
      .select({
        date: sql<string>`DATE(${toolUsageLogTable.createdAt})`,
        count: count(),
      })
      .from(toolUsageLogTable)
      .where(gte(toolUsageLogTable.createdAt, monthStart))
      .groupBy(sql`DATE(${toolUsageLogTable.createdAt})`)
      .orderBy(sql`DATE(${toolUsageLogTable.createdAt})`);

    const perToolDailyUsage = await db
      .select({
        toolId: toolUsageLogTable.toolId,
        toolName: toolsTable.name,
        date: sql<string>`DATE(${toolUsageLogTable.createdAt})`,
        count: count(),
      })
      .from(toolUsageLogTable)
      .innerJoin(toolsTable, eq(toolUsageLogTable.toolId, toolsTable.id))
      .where(gte(toolUsageLogTable.createdAt, monthStart))
      .groupBy(toolUsageLogTable.toolId, toolsTable.name, sql`DATE(${toolUsageLogTable.createdAt})`)
      .orderBy(toolUsageLogTable.toolId, sql`DATE(${toolUsageLogTable.createdAt})`);

    const todayCount = totalOpensToday?.count ?? 0;
    const yesterdayCount = totalOpensYesterday?.count ?? 0;
    const weekCount = totalOpensWeek?.count ?? 0;
    const prevWeekCount = totalOpensPrevWeek?.count ?? 0;
    const monthCount = totalOpensMonth?.count ?? 0;
    const prevMonthCount = totalOpensPrevMonth?.count ?? 0;

    res.json({
      totalOpens: {
        today: todayCount,
        todayTrend: computeTrend(todayCount, yesterdayCount),
        week: weekCount,
        weekTrend: computeTrend(weekCount, prevWeekCount),
        month: monthCount,
        monthTrend: computeTrend(monthCount, prevMonthCount),
      },
      popularTools,
      usageByTier,
      aiStats: aiStats[0] ?? { totalGenerations: 0, totalTokens: 0, totalCostCents: 0 },
      toolAdoption,
      dailyUsage,
      perToolDailyUsage,
      totalUsers,
    });
  } catch (error) {
    console.error("[Admin] Error fetching tool analytics:", error);
    res.status(500).json({ error: "Failed to fetch tool analytics" });
  }
});

router.get("/admin/tools/:id/usage", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid tool ID" });
      return;
    }

    const [tool] = await db
      .select({
        id: toolsTable.id,
        slug: toolsTable.slug,
        name: toolsTable.name,
        shortDescription: toolsTable.shortDescription,
        longDescription: toolsTable.longDescription,
        icon: toolsTable.icon,
        categoryId: toolsTable.categoryId,
        categoryName: toolCategoriesTable.name,
        type: toolsTable.type,
        requiredEntitlement: toolsTable.requiredEntitlement,
        config: toolsTable.config,
        isFeatured: toolsTable.isFeatured,
        isNew: toolsTable.isNew,
        isBeta: toolsTable.isBeta,
        status: toolsTable.status,
        badge: toolsTable.badge,
        totalLaunches: toolsTable.totalLaunches,
        sortOrder: toolsTable.sortOrder,
        videoTutorialUrl: toolsTable.videoTutorialUrl,
        helpDocUrl: toolsTable.helpDocUrl,
        rateLimitPerDay: toolsTable.rateLimitPerDay,
        createdAt: toolsTable.createdAt,
        updatedAt: toolsTable.updatedAt,
      })
      .from(toolsTable)
      .leftJoin(toolCategoriesTable, eq(toolsTable.categoryId, toolCategoriesTable.id))
      .where(eq(toolsTable.id, id));
    if (!tool) {
      res.status(404).json({ error: "Tool not found" });
      return;
    }

    const monthStart = new Date();
    monthStart.setDate(monthStart.getDate() - 30);

    const dailyUsage = await db
      .select({
        date: sql<string>`DATE(${toolUsageLogTable.createdAt})`,
        count: count(),
      })
      .from(toolUsageLogTable)
      .where(and(eq(toolUsageLogTable.toolId, id), gte(toolUsageLogTable.createdAt, monthStart)))
      .groupBy(sql`DATE(${toolUsageLogTable.createdAt})`)
      .orderBy(sql`DATE(${toolUsageLogTable.createdAt})`);

    const actionBreakdown = await db
      .select({
        action: toolUsageLogTable.action,
        count: count(),
      })
      .from(toolUsageLogTable)
      .where(and(eq(toolUsageLogTable.toolId, id), gte(toolUsageLogTable.createdAt, monthStart)))
      .groupBy(toolUsageLogTable.action);

    const uniqueUsers = await db
      .select({ count: countDistinct(toolUsageLogTable.userId) })
      .from(toolUsageLogTable)
      .where(and(eq(toolUsageLogTable.toolId, id), gte(toolUsageLogTable.createdAt, monthStart)));

    const [totalOpens] = await db
      .select({ count: count() })
      .from(toolUsageLogTable)
      .where(and(eq(toolUsageLogTable.toolId, id), eq(toolUsageLogTable.action, "open")));

    res.json({
      tool,
      dailyUsage,
      actionBreakdown,
      uniqueUsers: uniqueUsers[0]?.count ?? 0,
      totalOpensAllTime: totalOpens?.count ?? 0,
    });
  } catch (error) {
    console.error("[Admin] Error fetching tool usage:", error);
    res.status(500).json({ error: "Failed to fetch tool usage" });
  }
});

export default router;
