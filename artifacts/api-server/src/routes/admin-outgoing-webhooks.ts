import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { db, webhookSubscriptionsTable, webhookDeliveriesTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { retryDelivery } from "../lib/outgoing-webhook-queue";
import { sendTestEvent, WEBHOOK_EVENT_TYPES } from "../lib/webhook-events";

function isUrlSafe(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1") return false;
    if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

const router = Router();

router.get("/admin/outgoing-webhooks/event-types", requirePermission("settings:view"), async (_req: Request, res: Response) => {
  res.json({ eventTypes: WEBHOOK_EVENT_TYPES });
});

router.get("/admin/outgoing-webhooks", requirePermission("settings:view"), async (req: Request, res: Response) => {
  try {
    const subscriptions = await db.select()
      .from(webhookSubscriptionsTable)
      .orderBy(desc(webhookSubscriptionsTable.createdAt));

    const subsWithStats = await Promise.all(subscriptions.map(async (sub) => {
      const [stats] = await db.select({
        totalDeliveries: sql<number>`count(*)::int`,
        successCount: sql<number>`count(*) filter (where ${webhookDeliveriesTable.status} = 'delivered')::int`,
        failedCount: sql<number>`count(*) filter (where ${webhookDeliveriesTable.status} = 'failed')::int`,
        pendingCount: sql<number>`count(*) filter (where ${webhookDeliveriesTable.status} in ('pending', 'retrying'))::int`,
      }).from(webhookDeliveriesTable)
        .where(eq(webhookDeliveriesTable.subscriptionId, sub.id));

      return {
        ...sub,
        secret: undefined,
        stats: stats || { totalDeliveries: 0, successCount: 0, failedCount: 0, pendingCount: 0 },
      };
    }));

    res.json({ subscriptions: subsWithStats });
  } catch (error) {
    console.error("[Admin] Error fetching outgoing webhooks:", error);
    res.status(500).json({ error: "Failed to fetch webhook subscriptions" });
  }
});

router.post("/admin/outgoing-webhooks", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const { name, targetUrl, eventTypes } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!targetUrl || typeof targetUrl !== "string") {
      res.status(400).json({ error: "targetUrl is required" });
      return;
    }
    if (!isUrlSafe(targetUrl)) {
      res.status(400).json({ error: "targetUrl must be a valid public HTTPS/HTTP URL" });
      return;
    }
    if (!eventTypes || !Array.isArray(eventTypes) || eventTypes.length === 0) {
      res.status(400).json({ error: "eventTypes must be a non-empty array" });
      return;
    }

    const secret = `whsec_${crypto.randomBytes(32).toString("hex")}`;

    const [subscription] = await db.insert(webhookSubscriptionsTable).values({
      name: name.trim(),
      targetUrl,
      secret,
      eventTypes,
      active: true,
      createdById: req.userId || null,
    }).returning();

    res.status(201).json({
      ...subscription,
      secret,
    });
  } catch (error) {
    console.error("[Admin] Error creating outgoing webhook:", error);
    res.status(500).json({ error: "Failed to create webhook subscription" });
  }
});

router.get("/admin/outgoing-webhooks/:id", requirePermission("settings:view"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid subscription ID" });
      return;
    }

    const [subscription] = await db.select()
      .from(webhookSubscriptionsTable)
      .where(eq(webhookSubscriptionsTable.id, id))
      .limit(1);

    if (!subscription) {
      res.status(404).json({ error: "Webhook subscription not found" });
      return;
    }

    res.json({ ...subscription, secret: undefined });
  } catch (error) {
    console.error("[Admin] Error fetching outgoing webhook:", error);
    res.status(500).json({ error: "Failed to fetch webhook subscription" });
  }
});

router.put("/admin/outgoing-webhooks/:id", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid subscription ID" });
      return;
    }

    const { name, targetUrl, eventTypes, active } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "name must be a non-empty string" });
        return;
      }
      updates.name = name.trim();
    }
    if (targetUrl !== undefined) {
      if (!isUrlSafe(targetUrl)) {
        res.status(400).json({ error: "targetUrl must be a valid public HTTPS/HTTP URL" });
        return;
      }
      updates.targetUrl = targetUrl;
    }
    if (eventTypes !== undefined) {
      if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
        res.status(400).json({ error: "eventTypes must be a non-empty array" });
        return;
      }
      updates.eventTypes = eventTypes;
    }
    if (active !== undefined) {
      updates.active = !!active;
      if (active) {
        updates.disabledAt = null;
        updates.disabledReason = null;
        updates.consecutiveFailureDays = 0;
      }
    }

    const [updated] = await db.update(webhookSubscriptionsTable)
      .set(updates)
      .where(eq(webhookSubscriptionsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Webhook subscription not found" });
      return;
    }

    res.json({ ...updated, secret: undefined });
  } catch (error) {
    console.error("[Admin] Error updating outgoing webhook:", error);
    res.status(500).json({ error: "Failed to update webhook subscription" });
  }
});

router.delete("/admin/outgoing-webhooks/:id", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid subscription ID" });
      return;
    }

    const [deleted] = await db.delete(webhookSubscriptionsTable)
      .where(eq(webhookSubscriptionsTable.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Webhook subscription not found" });
      return;
    }

    res.json({ message: "Webhook subscription deleted" });
  } catch (error) {
    console.error("[Admin] Error deleting outgoing webhook:", error);
    res.status(500).json({ error: "Failed to delete webhook subscription" });
  }
});

router.post("/admin/outgoing-webhooks/:id/rotate-secret", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid subscription ID" });
      return;
    }

    const newSecret = `whsec_${crypto.randomBytes(32).toString("hex")}`;

    const [updated] = await db.update(webhookSubscriptionsTable)
      .set({ secret: newSecret, updatedAt: new Date() })
      .where(eq(webhookSubscriptionsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Webhook subscription not found" });
      return;
    }

    res.json({ secret: newSecret });
  } catch (error) {
    console.error("[Admin] Error rotating webhook secret:", error);
    res.status(500).json({ error: "Failed to rotate webhook secret" });
  }
});

router.post("/admin/outgoing-webhooks/:id/test", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid subscription ID" });
      return;
    }

    const result = await sendTestEvent(id);
    if (!result) {
      res.status(404).json({ error: "Webhook subscription not found" });
      return;
    }

    res.json({ message: "Test event sent", ...result });
  } catch (error) {
    console.error("[Admin] Error sending test event:", error);
    res.status(500).json({ error: "Failed to send test event" });
  }
});

router.get("/admin/outgoing-webhooks/:id/deliveries", requirePermission("settings:view"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid subscription ID" });
      return;
    }

    const { status, eventType, startDate, endDate, page = "1", limit = "50" } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [eq(webhookDeliveriesTable.subscriptionId, id)];

    if (status && typeof status === "string") {
      conditions.push(eq(webhookDeliveriesTable.status, status));
    }
    if (eventType && typeof eventType === "string") {
      conditions.push(eq(webhookDeliveriesTable.eventType, eventType));
    }
    if (startDate && typeof startDate === "string") {
      conditions.push(gte(webhookDeliveriesTable.createdAt, new Date(startDate)));
    }
    if (endDate && typeof endDate === "string") {
      conditions.push(lte(webhookDeliveriesTable.createdAt, new Date(endDate)));
    }

    const whereClause = and(...conditions);

    const [deliveries, countResult] = await Promise.all([
      db.select()
        .from(webhookDeliveriesTable)
        .where(whereClause)
        .orderBy(desc(webhookDeliveriesTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` })
        .from(webhookDeliveriesTable)
        .where(whereClause),
    ]);

    res.json({
      deliveries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: Number(countResult[0]?.count || 0),
        totalPages: Math.ceil(Number(countResult[0]?.count || 0) / limitNum),
      },
    });
  } catch (error) {
    console.error("[Admin] Error fetching webhook deliveries:", error);
    res.status(500).json({ error: "Failed to fetch webhook deliveries" });
  }
});

router.get("/admin/outgoing-webhook-deliveries", requirePermission("settings:view"), async (req: Request, res: Response) => {
  try {
    const { status, eventType, startDate, endDate, subscriptionId, page = "1", limit = "50" } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];

    if (subscriptionId && typeof subscriptionId === "string") {
      const subId = parseInt(subscriptionId, 10);
      if (!isNaN(subId)) {
        conditions.push(eq(webhookDeliveriesTable.subscriptionId, subId));
      }
    }
    if (status && typeof status === "string") {
      conditions.push(eq(webhookDeliveriesTable.status, status));
    }
    if (eventType && typeof eventType === "string") {
      conditions.push(eq(webhookDeliveriesTable.eventType, eventType));
    }
    if (startDate && typeof startDate === "string") {
      conditions.push(gte(webhookDeliveriesTable.createdAt, new Date(startDate)));
    }
    if (endDate && typeof endDate === "string") {
      conditions.push(lte(webhookDeliveriesTable.createdAt, new Date(endDate)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [deliveries, countResult] = await Promise.all([
      db.select({
        id: webhookDeliveriesTable.id,
        subscriptionId: webhookDeliveriesTable.subscriptionId,
        subscriptionName: webhookSubscriptionsTable.name,
        eventType: webhookDeliveriesTable.eventType,
        eventId: webhookDeliveriesTable.eventId,
        status: webhookDeliveriesTable.status,
        httpStatus: webhookDeliveriesTable.httpStatus,
        errorMessage: webhookDeliveriesTable.errorMessage,
        attemptCount: webhookDeliveriesTable.attemptCount,
        maxAttempts: webhookDeliveriesTable.maxAttempts,
        completedAt: webhookDeliveriesTable.completedAt,
        createdAt: webhookDeliveriesTable.createdAt,
      })
        .from(webhookDeliveriesTable)
        .innerJoin(webhookSubscriptionsTable, eq(webhookDeliveriesTable.subscriptionId, webhookSubscriptionsTable.id))
        .where(whereClause)
        .orderBy(desc(webhookDeliveriesTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` })
        .from(webhookDeliveriesTable)
        .where(whereClause),
    ]);

    res.json({
      deliveries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: Number(countResult[0]?.count || 0),
        totalPages: Math.ceil(Number(countResult[0]?.count || 0) / limitNum),
      },
    });
  } catch (error) {
    console.error("[Admin] Error fetching all webhook deliveries:", error);
    res.status(500).json({ error: "Failed to fetch webhook deliveries" });
  }
});

router.post("/admin/outgoing-webhook-deliveries/:id/retry", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid delivery ID" });
      return;
    }

    const success = await retryDelivery(id);
    if (!success) {
      res.status(404).json({ error: "Delivery not found or already delivered" });
      return;
    }

    res.json({ message: "Delivery retry queued" });
  } catch (error) {
    console.error("[Admin] Error retrying webhook delivery:", error);
    res.status(500).json({ error: "Failed to retry webhook delivery" });
  }
});

export default router;
