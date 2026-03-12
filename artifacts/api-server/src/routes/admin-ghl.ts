import { Router, type Request, type Response } from "express";
import { db, usersTable, ghlSyncLogTable, ghlConfigTable } from "@workspace/db";
import { eq, and, desc, sql, like, or, isNull, isNotNull } from "drizzle-orm";
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

    const [lastSuccess] = await db.select({ processedAt: ghlSyncLogTable.processedAt })
      .from(ghlSyncLogTable)
      .where(eq(ghlSyncLogTable.status, "completed"))
      .orderBy(desc(ghlSyncLogTable.processedAt))
      .limit(1);

    const [enabledConfig] = await db.select()
      .from(ghlConfigTable)
      .where(eq(ghlConfigTable.configKey, "sync_enabled"))
      .limit(1);

    res.json({
      configured,
      queue: queueStatus,
      syncLog: syncStats,
      lastSuccessfulSync: lastSuccess?.processedAt || null,
      queueDepth: queueStatus?.waiting || 0,
      failedJobCount: Number(syncStats?.failed || 0),
      totalSyncs: Number(syncStats?.total || 0),
      syncEnabled: enabledConfig?.enabled ?? false,
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

router.get("/admin/ghl/recent-activity", requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));

    const logs = await db.select({
      id: ghlSyncLogTable.id,
      userId: ghlSyncLogTable.userId,
      direction: ghlSyncLogTable.direction,
      action: ghlSyncLogTable.action,
      status: ghlSyncLogTable.status,
      ghlContactId: ghlSyncLogTable.ghlContactId,
      errorMessage: ghlSyncLogTable.errorMessage,
      attempts: ghlSyncLogTable.attempts,
      processedAt: ghlSyncLogTable.processedAt,
      createdAt: ghlSyncLogTable.createdAt,
    })
      .from(ghlSyncLogTable)
      .orderBy(desc(ghlSyncLogTable.createdAt))
      .limit(limit);

    res.json(logs);
  } catch (error) {
    console.error("[Admin GHL] Error fetching recent activity:", error);
    res.status(500).json({ error: "Failed to fetch recent activity" });
  }
});

router.get("/admin/ghl/failed-jobs", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const failed = await db.select({
      id: ghlSyncLogTable.id,
      userId: ghlSyncLogTable.userId,
      direction: ghlSyncLogTable.direction,
      action: ghlSyncLogTable.action,
      status: ghlSyncLogTable.status,
      ghlContactId: ghlSyncLogTable.ghlContactId,
      errorMessage: ghlSyncLogTable.errorMessage,
      payload: ghlSyncLogTable.payload,
      attempts: ghlSyncLogTable.attempts,
      processedAt: ghlSyncLogTable.processedAt,
      createdAt: ghlSyncLogTable.createdAt,
    })
      .from(ghlSyncLogTable)
      .where(eq(ghlSyncLogTable.status, "failed"))
      .orderBy(desc(ghlSyncLogTable.createdAt))
      .limit(100);

    res.json(failed);
  } catch (error) {
    console.error("[Admin GHL] Error fetching failed jobs:", error);
    res.status(500).json({ error: "Failed to fetch failed jobs" });
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

router.get("/admin/ghl/contacts", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { search, filter, page = "1", limit = "25" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 25));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];

    if (search && typeof search === "string") {
      conditions.push(
        or(
          like(usersTable.name, `%${search}%`),
          like(usersTable.email, `%${search}%`),
        )
      );
    }

    if (filter === "synced") {
      conditions.push(isNotNull(usersTable.ghlContactId));
    } else if (filter === "not_synced") {
      conditions.push(isNull(usersTable.ghlContactId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [users, countResult] = await Promise.all([
      db.select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        ghlContactId: usersTable.ghlContactId,
        memberSince: usersTable.memberSince,
        updatedAt: usersTable.updatedAt,
      })
        .from(usersTable)
        .where(whereClause)
        .orderBy(desc(usersTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` })
        .from(usersTable)
        .where(whereClause),
    ]);

    const userIds = users.map(u => u.id);
    let lastSyncMap: Record<number, string> = {};
    if (userIds.length > 0) {
      const syncLogs = await db.select({
        userId: ghlSyncLogTable.userId,
        lastSync: sql<string>`MAX(${ghlSyncLogTable.processedAt})`,
      })
        .from(ghlSyncLogTable)
        .where(and(
          sql`${ghlSyncLogTable.userId} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`,
          eq(ghlSyncLogTable.status, "completed"),
        ))
        .groupBy(ghlSyncLogTable.userId);

      for (const log of syncLogs) {
        if (log.userId) {
          lastSyncMap[log.userId] = log.lastSync;
        }
      }
    }

    const contacts = users.map(u => ({
      ...u,
      lastSyncDate: lastSyncMap[u.id] || null,
    }));

    res.json({
      contacts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: Number(countResult[0]?.count || 0),
        totalPages: Math.ceil(Number(countResult[0]?.count || 0) / limitNum),
      },
    });
  } catch (error) {
    console.error("[Admin GHL] Error fetching contacts:", error);
    res.status(500).json({ error: "Failed to fetch contacts" });
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

router.post("/admin/ghl/sync-member/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    const [user] = await db.select()
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

    res.json({ message: "Sync job created", jobId, userId: user.id });
  } catch (error) {
    console.error("[Admin GHL] Error syncing member:", error);
    res.status(500).json({ error: "Failed to queue member sync" });
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

router.post("/admin/ghl/bulk-sync", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const users = await db.select().from(usersTable);

    if (users.length === 0) {
      res.json({ message: "No members to sync", jobCount: 0 });
      return;
    }

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

    res.json({ message: "Bulk sync jobs created", jobCount: jobIds.length });
  } catch (error) {
    console.error("[Admin GHL] Error creating bulk sync:", error);
    res.status(500).json({ error: "Failed to create bulk sync jobs" });
  }
});

router.get("/admin/ghl/config", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const configs = await db.select().from(ghlConfigTable).orderBy(ghlConfigTable.configKey);

    const configMap: Record<string, any> = {};
    for (const c of configs) {
      configMap[c.configKey] = c.jsonValue ?? c.configValue;
    }

    res.json({
      configs,
      apiKey: configMap.api_key || "",
      locationId: configMap.location_id || "",
      webhookSecret: configMap.webhook_secret || "",
      tagPrefix: configMap.tag_prefix || "BTS:",
      syncEnabled: configMap.sync_enabled === "true" || configMap.sync_enabled === true,
      pipelineStageMapping: configMap.pipeline_stage_mapping || {},
      customFieldMapping: configMap.custom_field_mapping || {},
    });
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

router.put("/admin/ghl/config", requireAdmin, async (req: Request, res: Response) => {
  try {
    const {
      apiKey,
      locationId,
      webhookSecret,
      tagPrefix,
      syncEnabled,
      pipelineStageMapping,
      customFieldMapping,
    } = req.body;

    const simpleKeys: Record<string, { value: string; desc: string } | undefined> = {
      api_key: apiKey !== undefined ? { value: apiKey, desc: "GHL API Key" } : undefined,
      location_id: locationId !== undefined ? { value: locationId, desc: "GHL Location ID" } : undefined,
      webhook_secret: webhookSecret !== undefined ? { value: webhookSecret, desc: "Webhook verification secret" } : undefined,
      tag_prefix: tagPrefix !== undefined ? { value: tagPrefix, desc: "Tag prefix for GHL contacts" } : undefined,
      sync_enabled: syncEnabled !== undefined ? { value: String(syncEnabled), desc: "Global sync enable/disable" } : undefined,
    };

    for (const [key, entry] of Object.entries(simpleKeys)) {
      if (entry !== undefined) {
        const existing = await db.select().from(ghlConfigTable).where(eq(ghlConfigTable.configKey, key)).limit(1);
        if (existing.length > 0) {
          await db.update(ghlConfigTable)
            .set({ configValue: entry.value })
            .where(eq(ghlConfigTable.configKey, key));
        } else {
          await db.insert(ghlConfigTable).values({
            configKey: key,
            configValue: entry.value,
            description: entry.desc,
            enabled: true,
          });
        }
      }
    }

    const jsonKeys: Record<string, { value: any; desc: string } | undefined> = {
      pipeline_stage_mapping: pipelineStageMapping !== undefined ? { value: pipelineStageMapping, desc: "Pipeline/stage ID mappings" } : undefined,
      custom_field_mapping: customFieldMapping !== undefined ? { value: customFieldMapping, desc: "Custom field key mappings" } : undefined,
    };

    for (const [key, entry] of Object.entries(jsonKeys)) {
      if (entry !== undefined) {
        const existing = await db.select().from(ghlConfigTable).where(eq(ghlConfigTable.configKey, key)).limit(1);
        if (existing.length > 0) {
          await db.update(ghlConfigTable)
            .set({ configValue: JSON.stringify(entry.value), jsonValue: entry.value })
            .where(eq(ghlConfigTable.configKey, key));
        } else {
          await db.insert(ghlConfigTable).values({
            configKey: key,
            configValue: JSON.stringify(entry.value),
            jsonValue: entry.value,
            description: entry.desc,
            enabled: true,
          });
        }
      }
    }

    const configs = await db.select().from(ghlConfigTable).orderBy(ghlConfigTable.configKey);
    const configMap: Record<string, any> = {};
    for (const c of configs) {
      configMap[c.configKey] = c.jsonValue ?? c.configValue;
    }

    res.json({
      apiKey: configMap.api_key || "",
      locationId: configMap.location_id || "",
      webhookSecret: configMap.webhook_secret || "",
      tagPrefix: configMap.tag_prefix || "BTS:",
      syncEnabled: configMap.sync_enabled === "true" || configMap.sync_enabled === true,
      pipelineStageMapping: configMap.pipeline_stage_mapping || {},
      customFieldMapping: configMap.custom_field_mapping || {},
    });
  } catch (error) {
    console.error("[Admin GHL] Error updating config:", error);
    res.status(500).json({ error: "Failed to update GHL config" });
  }
});

export default router;
