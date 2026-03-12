import { Router, type Request, type Response } from "express";
import { db, webhookLogsTable, productsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/admin/webhook-logs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { status, eventType, startDate, endDate, page = "1", limit = "50" } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];

    if (status && typeof status === "string") {
      conditions.push(eq(webhookLogsTable.status, status));
    }
    if (eventType && typeof eventType === "string") {
      conditions.push(eq(webhookLogsTable.eventType, eventType));
    }
    if (startDate && typeof startDate === "string") {
      conditions.push(gte(webhookLogsTable.createdAt, new Date(startDate)));
    }
    if (endDate && typeof endDate === "string") {
      conditions.push(lte(webhookLogsTable.createdAt, new Date(endDate)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [logs, countResult] = await Promise.all([
      db.select()
        .from(webhookLogsTable)
        .where(whereClause)
        .orderBy(desc(webhookLogsTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` })
        .from(webhookLogsTable)
        .where(whereClause),
    ]);

    res.json({
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: Number(countResult[0]?.count || 0),
        totalPages: Math.ceil(Number(countResult[0]?.count || 0) / limitNum),
      },
    });
  } catch (error) {
    console.error("[Admin] Error fetching webhook logs:", error);
    res.status(500).json({ error: "Failed to fetch webhook logs" });
  }
});

router.get("/admin/webhook-logs/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid log ID" });
      return;
    }

    const [log] = await db.select()
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.id, id))
      .limit(1);

    if (!log) {
      res.status(404).json({ error: "Webhook log not found" });
      return;
    }

    res.json(log);
  } catch (error) {
    console.error("[Admin] Error fetching webhook log:", error);
    res.status(500).json({ error: "Failed to fetch webhook log" });
  }
});

router.get("/admin/product-mappings", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const products = await db.select({
      id: productsTable.id,
      slug: productsTable.slug,
      name: productsTable.name,
      thrivecartProductId: productsTable.thrivecartProductId,
    })
      .from(productsTable)
      .orderBy(productsTable.sortOrder);

    res.json(products);
  } catch (error) {
    console.error("[Admin] Error fetching product mappings:", error);
    res.status(500).json({ error: "Failed to fetch product mappings" });
  }
});

router.put("/admin/product-mappings/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid product ID" });
      return;
    }

    const { thrivecartProductId } = req.body;
    if (thrivecartProductId === undefined) {
      res.status(400).json({ error: "thrivecartProductId is required" });
      return;
    }

    if (thrivecartProductId !== null && thrivecartProductId !== "") {
      const existing = await db.select({ id: productsTable.id })
        .from(productsTable)
        .where(and(
          eq(productsTable.thrivecartProductId, thrivecartProductId),
        ))
        .limit(1);

      if (existing.length > 0 && existing[0].id !== id) {
        res.status(409).json({
          error: `ThriveCart product ID "${thrivecartProductId}" is already mapped to another product (ID: ${existing[0].id})`,
        });
        return;
      }
    }

    const [updated] = await db.update(productsTable)
      .set({ thrivecartProductId: thrivecartProductId || null })
      .where(eq(productsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    res.json({
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      thrivecartProductId: updated.thrivecartProductId,
    });
  } catch (error) {
    console.error("[Admin] Error updating product mapping:", error);
    res.status(500).json({ error: "Failed to update product mapping" });
  }
});

export default router;
