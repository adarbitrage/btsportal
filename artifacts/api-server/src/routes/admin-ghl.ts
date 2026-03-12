import { Router, type Request, type Response } from "express";
import { db, usersTable, ghlSyncLogTable, ghlConfigTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { queueGHLSync, getQueueStatus, retryJob } from "../lib/ghl-queue";
import * as ghlClient from "../lib/ghl-client";

const router = Router();

function requireAdmin(req: Request, res: Response, next: Function) {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  db.select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId))
    .limit(1)
    .then(([user]) => {
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      next();
    })
    .catch(() => {
      res.status(500).json({ error: "Failed to verify admin status" });
    });
}

router.get("/admin/ghl/status", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const queueStatus = await getQueueStatus();
    const configured = ghlClient.isConfigured();

    const [syncStats] = await db
      .select({
        total: sql<number>`count(*)`,
        completed: sql<number>`count(*) filter (where ${ghlSyncLogTable.status} = 'completed')`,
        failed: sql<number>`count(*) filter (where ${ghlSyncLogTable.status} = 'failed')`,
        retrying: sql<number>`count(*) filter (where ${ghlSyncLogTable.status} = 'retrying')`,
      })
      .from(ghlSyncLogTable);

    res.json({
      configured,
      queue: queueStatus,
      syncLog: syncStats,
    });
  } catch (error) {
    console.error("[Admin GHL] Error fetching status:", error);
    res.status(500).json({ error: "Failed to fetch GHL status" });
  }
});

router.get("/admin/ghl/log", requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;
    const userId = req.query.userId ? parseInt(req.query.userId as string) : undefined;

    const conditions = [];
    if (status) {
      conditions.push(eq(ghlSyncLogTable.status, status));
    }
    if (userId) {
      conditions.push(eq(ghlSyncLogTable.userId, userId));
    }

    const baseQuery = db.select().from(ghlSyncLogTable).orderBy(desc(ghlSyncLogTable.createdAt));
    const logs = conditions.length > 0
      ? await baseQuery.where(and(...conditions)).limit(limit).offset(offset)
      : await baseQuery.limit(limit).offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(ghlSyncLogTable);

    res.json({ logs, total: count, limit, offset });
  } catch (error) {
    console.error("[Admin GHL] Error fetching logs:", error);
    res.status(500).json({ error: "Failed to fetch GHL sync logs" });
  }
});

router.post("/admin/ghl/sync/:userId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string);
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const jobId = await queueGHLSync({
      action: "create_contact",
      userId: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone || undefined,
      customFields: {
        portal_member_since: user.memberSince?.toISOString() || "",
        portal_role: user.role,
        onboarding_complete: String(user.onboardingComplete),
      },
    });

    res.json({ success: true, jobId, userId: user.id, email: user.email });
  } catch (error) {
    console.error("[Admin GHL] Error syncing user:", error);
    res.status(500).json({ error: "Failed to queue user sync" });
  }
});

router.post("/admin/ghl/sync-all", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const users = await db.select().from(usersTable);
    const jobIds: string[] = [];

    for (const user of users) {
      const jobId = await queueGHLSync({
        action: "create_contact",
        userId: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone || undefined,
        customFields: {
          portal_member_since: user.memberSince?.toISOString() || "",
          portal_role: user.role,
          onboarding_complete: String(user.onboardingComplete),
        },
      });
      if (jobId) jobIds.push(jobId);
    }

    res.json({ success: true, totalUsers: users.length, jobsQueued: jobIds.length });
  } catch (error) {
    console.error("[Admin GHL] Error syncing all users:", error);
    res.status(500).json({ error: "Failed to queue bulk sync" });
  }
});

router.get("/admin/ghl/config", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const configs = await db.select().from(ghlConfigTable).orderBy(ghlConfigTable.configKey);
    res.json({ configs });
  } catch (error) {
    console.error("[Admin GHL] Error fetching config:", error);
    res.status(500).json({ error: "Failed to fetch GHL config" });
  }
});

router.patch("/admin/ghl/config", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { configKey, configValue, description, enabled } = req.body;

    if (!configKey || configValue === undefined) {
      res.status(400).json({ error: "configKey and configValue are required" });
      return;
    }

    const existing = await db
      .select()
      .from(ghlConfigTable)
      .where(eq(ghlConfigTable.configKey, configKey))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(ghlConfigTable)
        .set({
          configValue: String(configValue),
          description: description || existing[0].description,
          enabled: enabled !== undefined ? enabled : existing[0].enabled,
        })
        .where(eq(ghlConfigTable.configKey, configKey))
        .returning();
      res.json({ config: updated });
    } else {
      const [created] = await db
        .insert(ghlConfigTable)
        .values({
          configKey,
          configValue: String(configValue),
          description: description || null,
          enabled: enabled !== undefined ? enabled : true,
        })
        .returning();
      res.status(201).json({ config: created });
    }
  } catch (error) {
    console.error("[Admin GHL] Error updating config:", error);
    res.status(500).json({ error: "Failed to update GHL config" });
  }
});

router.post("/admin/ghl/retry/:jobId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;
    const success = await retryJob(jobId);

    if (!success) {
      res.status(404).json({ error: "Job not found or cannot be retried" });
      return;
    }

    res.json({ success: true, jobId });
  } catch (error) {
    console.error("[Admin GHL] Error retrying job:", error);
    res.status(500).json({ error: "Failed to retry job" });
  }
});

export default router;
