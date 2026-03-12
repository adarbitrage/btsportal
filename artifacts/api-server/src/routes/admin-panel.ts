import { Router, type Request, type Response } from "express";
import { db, usersTable, userProductsTable, productsTable, ticketsTable, auditLogTable, systemSettingsTable, adminNotesTable, progressTable } from "@workspace/db";
import { eq, and, gte, lte, desc, asc, sql, ilike, or } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { logAdminAction } from "../lib/audit-log";
import jwt from "jsonwebtoken";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn("[Admin] JWT_SECRET not set — impersonation will be unavailable");
}

async function safeCount(query: Promise<any[]>): Promise<number> {
  try {
    const result = await query;
    return Number(result[0]?.count || 0);
  } catch {
    return 0;
  }
}

async function safeQuery<T>(query: Promise<T[]>, fallback: T[] = []): Promise<T[]> {
  try {
    return await query;
  } catch {
    return fallback;
  }
}

router.get("/admin/dashboard/kpis", requirePermission("dashboard:view"), async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [totalMembers, newMembers, openTickets, activeProducts] = await Promise.all([
      safeCount(db.select({ count: sql<number>`count(*)` }).from(usersTable).where(eq(usersTable.role, "member"))),
      safeCount(db.select({ count: sql<number>`count(*)` }).from(usersTable).where(and(eq(usersTable.role, "member"), gte(usersTable.createdAt, thirtyDaysAgo)))),
      safeCount(db.select({ count: sql<number>`count(*)` }).from(ticketsTable).where(or(eq(ticketsTable.status, "open"), eq(ticketsTable.status, "in_progress")))),
      safeCount(db.select({ count: sql<number>`count(*)` }).from(userProductsTable).where(eq(userProductsTable.status, "active"))),
    ]);

    res.json({
      totalMembers,
      newMembers30d: newMembers,
      openTickets,
      activeSubscriptions: activeProducts,
      slaBreaches30d: 0,
    });
  } catch (error) {
    console.error("[Admin] Dashboard KPIs error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard KPIs" });
  }
});

router.get("/admin/dashboard/activity-chart", requirePermission("dashboard:view"), async (_req: Request, res: Response) => {
  try {
    const days = 30;
    const data = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const [signups, tickets] = await Promise.all([
        safeCount(db.select({ count: sql<number>`count(*)` }).from(usersTable).where(and(gte(usersTable.createdAt, date), lte(usersTable.createdAt, nextDate)))),
        safeCount(db.select({ count: sql<number>`count(*)` }).from(ticketsTable).where(and(gte(ticketsTable.createdAt, date), lte(ticketsTable.createdAt, nextDate)))),
      ]);

      data.push({ date: dateStr, signups, tickets });
    }
    res.json(data);
  } catch (error) {
    console.error("[Admin] Activity chart error:", error);
    res.status(500).json({ error: "Failed to fetch activity chart data" });
  }
});

router.get("/admin/dashboard/needs-attention", requirePermission("dashboard:view"), async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const alerts: { type: string; severity: string; title: string; description: string; link?: string }[] = [];

    const openTicketCount = await safeCount(db.select({ count: sql<number>`count(*)` }).from(ticketsTable).where(eq(ticketsTable.status, "open")));
    if (openTicketCount > 10) {
      alerts.push({ type: "ticket_backlog", severity: "medium", title: "Ticket Backlog", description: `${openTicketCount} unassigned open tickets`, link: "/admin/tickets" });
    }

    const thirtyDaysFromNow = new Date(now);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const expiringProducts = await safeCount(
      db.select({ count: sql<number>`count(*)` }).from(userProductsTable)
        .where(and(eq(userProductsTable.status, "active"), gte(userProductsTable.expiresAt, now), lte(userProductsTable.expiresAt, thirtyDaysFromNow)))
    );
    if (expiringProducts > 0) {
      alerts.push({ type: "expiring_products", severity: "low", title: "Expiring Subscriptions", description: `${expiringProducts} subscription(s) expiring in 30 days` });
    }

    res.json(alerts);
  } catch (error) {
    console.error("[Admin] Needs attention error:", error);
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

router.get("/admin/dashboard/recent-activity", requirePermission("dashboard:view"), async (_req: Request, res: Response) => {
  try {
    const recentLogs = await db.select().from(auditLogTable).orderBy(desc(auditLogTable.createdAt)).limit(20);
    res.json(recentLogs);
  } catch (error) {
    console.error("[Admin] Recent activity error:", error);
    res.status(500).json({ error: "Failed to fetch recent activity" });
  }
});

router.get("/admin/search", requirePermission("dashboard:view"), async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || "").trim();
    if (!q || q.length < 2) {
      res.json({ members: [], tickets: [], posts: [] });
      return;
    }

    const searchPattern = `%${q}%`;

    const members = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
      .from(usersTable)
      .where(or(ilike(usersTable.name, searchPattern), ilike(usersTable.email, searchPattern)))
      .limit(10);

    const tickets = await safeQuery(
      db.select({ id: ticketsTable.id, ticketNumber: ticketsTable.ticketNumber, subject: ticketsTable.subject, status: ticketsTable.status })
        .from(ticketsTable)
        .where(or(ilike(ticketsTable.subject, searchPattern), ilike(ticketsTable.ticketNumber, searchPattern)))
        .limit(10)
    );

    res.json({ members, tickets, posts: [] });
  } catch (error) {
    console.error("[Admin] Search error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

router.get("/admin/audit-log", requirePermission("audit:view"), async (req: Request, res: Response) => {
  try {
    const { actionType, entityType, actorId, startDate, endDate, page = "1", limit = "50" } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (actionType && typeof actionType === "string") conditions.push(eq(auditLogTable.actionType, actionType));
    if (entityType && typeof entityType === "string") conditions.push(eq(auditLogTable.entityType, entityType));
    if (actorId && typeof actorId === "string") conditions.push(eq(auditLogTable.actorId, parseInt(actorId, 10)));
    if (startDate && typeof startDate === "string") conditions.push(gte(auditLogTable.createdAt, new Date(startDate)));
    if (endDate && typeof endDate === "string") conditions.push(lte(auditLogTable.createdAt, new Date(endDate)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [logs, countResult] = await Promise.all([
      db.select().from(auditLogTable).where(whereClause).orderBy(desc(auditLogTable.createdAt)).limit(limitNum).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(auditLogTable).where(whereClause),
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
    console.error("[Admin] Audit log error:", error);
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

router.get("/admin/audit-log/export", requirePermission("audit:view"), async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, format = "csv" } = req.query;
    const conditions: any[] = [];
    if (startDate && typeof startDate === "string") conditions.push(gte(auditLogTable.createdAt, new Date(startDate)));
    if (endDate && typeof endDate === "string") conditions.push(lte(auditLogTable.createdAt, new Date(endDate)));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const logs = await db.select().from(auditLogTable).where(whereClause).orderBy(desc(auditLogTable.createdAt)).limit(10000);

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=audit-log.json");
      res.json(logs);
    } else {
      const header = "id,actor_id,actor_email,action_type,entity_type,entity_id,description,ip_address,created_at\n";
      const rows = logs.map(l => `${l.id},${l.actorId || ""},${l.actorEmail || ""},${l.actionType},${l.entityType},${l.entityId || ""},"${(l.description || "").replace(/"/g, '""')}",${l.ipAddress || ""},${l.createdAt?.toISOString() || ""}`).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=audit-log.csv");
      res.send(header + rows);
    }
  } catch (error) {
    console.error("[Admin] Audit log export error:", error);
    res.status(500).json({ error: "Failed to export audit log" });
  }
});

router.get("/admin/members/:id/full", requirePermission("members:view"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const [member] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    const [products, tickets, progress, notes, auditHistory] = await Promise.all([
      safeQuery(
        db.select({ id: userProductsTable.id, productId: userProductsTable.productId, status: userProductsTable.status, expiresAt: userProductsTable.expiresAt, createdAt: userProductsTable.createdAt, productName: productsTable.name, productSlug: productsTable.slug })
          .from(userProductsTable).innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id)).where(eq(userProductsTable.userId, id))
      ),
      safeQuery(db.select().from(ticketsTable).where(eq(ticketsTable.userId, id)).orderBy(desc(ticketsTable.createdAt)).limit(20)),
      safeCount(db.select({ count: sql<number>`count(*)` }).from(progressTable).where(eq(progressTable.userId, id))),
      safeQuery(db.select().from(adminNotesTable).where(eq(adminNotesTable.userId, id)).orderBy(desc(adminNotesTable.createdAt))),
      safeQuery(db.select().from(auditLogTable).where(and(eq(auditLogTable.entityType, "user"), eq(auditLogTable.entityId, String(id)))).orderBy(desc(auditLogTable.createdAt)).limit(20)),
    ]);

    res.json({
      member: { ...member, passwordHash: undefined },
      products,
      tickets,
      trainingProgress: { completedLessons: progress },
      coachingSessions: [],
      commissions: [],
      community: { posts: 0, comments: 0 },
      adminNotes: notes,
      auditHistory,
    });
  } catch (error) {
    console.error("[Admin] Member detail error:", error);
    res.status(500).json({ error: "Failed to fetch member details" });
  }
});

router.post("/admin/members/:id/notes", requirePermission("members:edit"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const { content } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: "Note content is required" }); return; }

    const [note] = await db.insert(adminNotesTable).values({ userId: id, authorId: req.userId!, content: content.trim() }).returning();
    await logAdminAction(req, "create", "admin_note", String(note.id), `Added admin note for member ${id}`);
    res.json(note);
  } catch (error) {
    console.error("[Admin] Add note error:", error);
    res.status(500).json({ error: "Failed to add note" });
  }
});

router.post("/admin/members/:id/grant-product", requirePermission("members:edit"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { productId, expiresAt } = req.body;
    if (isNaN(id) || !productId) { res.status(400).json({ error: "Invalid request" }); return; }

    const [userProduct] = await db.insert(userProductsTable).values({
      userId: id,
      productId: parseInt(productId, 10),
      status: "active",
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    }).returning();

    await logAdminAction(req, "grant_product", "user", String(id), `Granted product ${productId} to member ${id}`);
    res.json(userProduct);
  } catch (error) {
    console.error("[Admin] Grant product error:", error);
    res.status(500).json({ error: "Failed to grant product" });
  }
});

router.post("/admin/members/:id/revoke-product", requirePermission("members:edit"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { userProductId } = req.body;
    if (isNaN(id) || !userProductId) { res.status(400).json({ error: "Invalid request" }); return; }

    const [updated] = await db.update(userProductsTable)
      .set({ status: "revoked" })
      .where(and(eq(userProductsTable.id, parseInt(userProductId, 10)), eq(userProductsTable.userId, id)))
      .returning();

    if (!updated) { res.status(404).json({ error: "User product not found" }); return; }
    await logAdminAction(req, "revoke_product", "user", String(id), `Revoked product (user_product ${userProductId}) from member ${id}`);
    res.json(updated);
  } catch (error) {
    console.error("[Admin] Revoke product error:", error);
    res.status(500).json({ error: "Failed to revoke product" });
  }
});

router.post("/admin/impersonate/:id", requirePermission("members:impersonate"), async (req: Request, res: Response) => {
  try {
    if (!JWT_SECRET) { res.status(503).json({ error: "Impersonation unavailable — JWT_SECRET not configured" }); return; }

    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const [target] = await db.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
    if (!target) { res.status(404).json({ error: "Member not found" }); return; }

    const impersonationToken = jwt.sign(
      { userId: target.id, email: target.email, impersonatedBy: req.userId, isImpersonation: true },
      JWT_SECRET,
      { expiresIn: "30m" }
    );

    await logAdminAction(req, "impersonate_start", "user", String(targetId), `Admin started impersonating member ${target.name} (${target.email})`);

    res.json({
      token: impersonationToken,
      member: { id: target.id, name: target.name, email: target.email },
      expiresIn: 1800,
    });
  } catch (error) {
    console.error("[Admin] Impersonation error:", error);
    res.status(500).json({ error: "Failed to start impersonation" });
  }
});

router.post("/admin/impersonate/stop", requirePermission("members:impersonate"), async (req: Request, res: Response) => {
  try {
    await logAdminAction(req, "impersonate_stop", "user", String(req.userId), "Admin stopped impersonation");
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Stop impersonation error:", error);
    res.status(500).json({ error: "Failed to stop impersonation" });
  }
});

router.get("/admin/export/:type", requirePermission("export:data"), async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    const { startDate, endDate, format = "csv" } = req.query;

    const conditions: any[] = [];
    let data: any[] = [];
    let headers = "";

    switch (type) {
      case "members": {
        if (startDate) conditions.push(gte(usersTable.createdAt, new Date(startDate as string)));
        if (endDate) conditions.push(lte(usersTable.createdAt, new Date(endDate as string)));
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        data = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, sourceProduct: usersTable.sourceProduct, memberSince: usersTable.memberSince, createdAt: usersTable.createdAt })
          .from(usersTable).where(whereClause).orderBy(desc(usersTable.createdAt)).limit(10000);
        headers = "id,name,email,role,source_product,member_since,created_at";
        break;
      }
      case "tickets": {
        if (startDate) conditions.push(gte(ticketsTable.createdAt, new Date(startDate as string)));
        if (endDate) conditions.push(lte(ticketsTable.createdAt, new Date(endDate as string)));
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        data = await safeQuery(db.select().from(ticketsTable).where(whereClause).orderBy(desc(ticketsTable.createdAt)).limit(10000));
        headers = "id,ticket_number,user_id,category,priority,status,subject,created_at";
        break;
      }
      default:
        res.status(400).json({ error: "Invalid export type. Use: members, tickets" });
        return;
    }

    await logAdminAction(req, "export_data", type, undefined, `Exported ${data.length} ${type} records`);

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename=${type}-export.json`);
      res.json(data);
    } else {
      const csvRows = data.map(row => {
        return Object.values(row).map(v => {
          if (v === null || v === undefined) return "";
          if (v instanceof Date) return v.toISOString();
          const s = String(v);
          return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(",");
      }).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=${type}-export.csv`);
      res.send(headers + "\n" + csvRows);
    }
  } catch (error) {
    console.error("[Admin] Export error:", error);
    res.status(500).json({ error: "Failed to export data" });
  }
});

router.get("/admin/system/health", requirePermission("system:view"), async (_req: Request, res: Response) => {
  try {
    const dbCheck = await db.execute(sql`SELECT 1 as ok`);
    const dbOk = dbCheck.rows?.length > 0;

    const [userCount, ticketCount, recentAuditLogs] = await Promise.all([
      safeCount(db.select({ count: sql<number>`count(*)` }).from(usersTable)),
      safeCount(db.select({ count: sql<number>`count(*)` }).from(ticketsTable)),
      safeCount(db.select({ count: sql<number>`count(*)` }).from(auditLogTable).where(gte(auditLogTable.createdAt, new Date(Date.now() - 86400000)))),
    ]);

    res.json({
      status: dbOk ? "healthy" : "degraded",
      services: {
        api: { status: "up", uptime: process.uptime() },
        database: { status: dbOk ? "up" : "down", totalUsers: userCount, totalTickets: ticketCount },
      },
      webhooks: { last24h: 0, failed24h: 0 },
      auditLogs: { last24h: recentAuditLogs },
      serverTime: new Date().toISOString(),
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
    });
  } catch (error) {
    console.error("[Admin] System health error:", error);
    res.status(500).json({ status: "error", error: "Failed to check system health" });
  }
});

router.get("/admin/notifications", requirePermission("notifications:view"), async (_req: Request, res: Response) => {
  try {
    const notifications: { id: string; type: string; severity: string; title: string; message: string; link?: string; createdAt: string }[] = [];

    const openTicketCount = await safeCount(db.select({ count: sql<number>`count(*)` }).from(ticketsTable).where(eq(ticketsTable.status, "open")));
    if (openTicketCount > 10) {
      notifications.push({
        id: "ticket-backlog", type: "ticket_backlog", severity: "medium",
        title: "Ticket Backlog", message: `${openTicketCount} open tickets need attention`,
        link: "/admin/tickets", createdAt: new Date().toISOString(),
      });
    }

    res.json(notifications);
  } catch (error) {
    console.error("[Admin] Notifications error:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

router.get("/admin/settings", requirePermission("settings:view"), async (_req: Request, res: Response) => {
  try {
    const settings = await db.select().from(systemSettingsTable).orderBy(asc(systemSettingsTable.category), asc(systemSettingsTable.key));
    res.json(settings);
  } catch (error) {
    console.error("[Admin] Settings error:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/admin/settings/:key", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { value, category, description } = req.body;

    if (value === undefined) { res.status(400).json({ error: "Value is required" }); return; }

    const existing = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.key, key)).limit(1);

    let result;
    if (existing.length > 0) {
      const oldValue = existing[0].value;
      [result] = await db.update(systemSettingsTable)
        .set({ value, updatedBy: req.userEmail || String(req.userId) })
        .where(eq(systemSettingsTable.key, key))
        .returning();
      await logAdminAction(req, "update_setting", "system_setting", key, `Updated setting: ${key}`, { oldValue, newValue: value });
    } else {
      [result] = await db.insert(systemSettingsTable).values({
        key, value, category: category || "general", description, updatedBy: req.userEmail || String(req.userId),
      }).returning();
      await logAdminAction(req, "create_setting", "system_setting", key, `Created setting: ${key}`);
    }

    res.json(result);
  } catch (error) {
    console.error("[Admin] Update setting error:", error);
    res.status(500).json({ error: "Failed to update setting" });
  }
});

router.get("/admin/members", requirePermission("members:view"), async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "20", search, role } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (search && typeof search === "string") {
      conditions.push(or(ilike(usersTable.name, `%${search}%`), ilike(usersTable.email, `%${search}%`)));
    }
    if (role && typeof role === "string" && role !== "all") {
      conditions.push(eq(usersTable.role, role));
    } else if (!role || role !== "all") {
      conditions.push(eq(usersTable.role, "member"));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [members, countResult] = await Promise.all([
      db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, sourceProduct: usersTable.sourceProduct, memberSince: usersTable.memberSince, lastLoginAt: usersTable.lastLoginAt, createdAt: usersTable.createdAt })
        .from(usersTable).where(whereClause).orderBy(desc(usersTable.createdAt)).limit(limitNum).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(usersTable).where(whereClause),
    ]);

    res.json({
      members,
      pagination: { page: pageNum, limit: limitNum, total: Number(countResult[0]?.count || 0), totalPages: Math.ceil(Number(countResult[0]?.count || 0) / limitNum) },
    });
  } catch (error) {
    console.error("[Admin] Members list error:", error);
    res.status(500).json({ error: "Failed to fetch members" });
  }
});

export default router;
