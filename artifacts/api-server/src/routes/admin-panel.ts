import { Router, type Request, type Response } from "express";
import { db, usersTable, userProductsTable, productsTable, ticketsTable, auditLogTable, systemSettingsTable, adminNotesTable, progressTable, emailChangeHistoryTable, emailChangeAttemptsTable } from "@workspace/db";
import { eq, and, gt, gte, lte, desc, asc, sql, ilike, or, isNotNull } from "drizzle-orm";
import { hasPermission, requirePermission } from "../middleware/rbac";
import { isSignupChallengeEnforced } from "../middleware/captcha";
import { logAdminAction, redactQueueFallbackPii } from "../lib/audit-log";
import { isRedisConnected } from "../lib/redis";
import { getQueueFallbackStatsFromDb } from "../lib/queue-fallback-tracker";
import { evaluateSignupChallengeAlert } from "../lib/signup-challenge-alerter";
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

// RFC 4180-style escaping for a single CSV field. Values containing commas,
// double quotes, or any kind of newline are wrapped in quotes, and embedded
// quotes are doubled. Null/undefined become empty fields and Date instances
// are serialized as ISO strings.
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

    const directMembers = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
      .from(usersTable)
      .where(or(ilike(usersTable.name, searchPattern), ilike(usersTable.email, searchPattern)))
      .limit(10);

    const previousEmailMatches = await safeQuery(
      db.select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        oldEmail: emailChangeHistoryTable.oldEmail,
        changedAt: emailChangeHistoryTable.changedAt,
      })
        .from(emailChangeHistoryTable)
        .innerJoin(usersTable, eq(emailChangeHistoryTable.userId, usersTable.id))
        .where(ilike(emailChangeHistoryTable.oldEmail, searchPattern))
        .orderBy(desc(emailChangeHistoryTable.changedAt))
        .limit(20)
    );

    const directIds = new Set(directMembers.map((m) => m.id));
    const seenPreviousIds = new Set<number>();
    const previousOnlyMembers: Array<{ id: number; name: string; email: string; role: string; matchedPreviousEmail: string }> = [];
    for (const row of previousEmailMatches) {
      if (directIds.has(row.id) || seenPreviousIds.has(row.id)) continue;
      seenPreviousIds.add(row.id);
      previousOnlyMembers.push({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        matchedPreviousEmail: row.oldEmail,
      });
    }

    const members = [...directMembers, ...previousOnlyMembers].slice(0, 10);

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
    const { actionType, entityType, actorId, startDate, endDate, page = "1", limit = "50", expand } = req.query;

    let pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));

    const conditions: any[] = [];
    if (actionType && typeof actionType === "string") conditions.push(eq(auditLogTable.actionType, actionType));
    if (entityType && typeof entityType === "string") conditions.push(eq(auditLogTable.entityType, entityType));
    if (actorId && typeof actorId === "string") conditions.push(eq(auditLogTable.actorId, parseInt(actorId, 10)));
    if (startDate && typeof startDate === "string") conditions.push(gte(auditLogTable.createdAt, new Date(startDate)));
    if (endDate && typeof endDate === "string") conditions.push(lte(auditLogTable.createdAt, new Date(endDate)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // If a deep-link supplied an `expand=<id>`, override the page so the row
    // actually lands on the rendered slice (otherwise older rows silently
    // fall onto page 1 and the user has to paginate by hand). We compute the
    // 1-indexed position of that row within the same filter+sort, then derive
    // the page from it. The main query uses (createdAt desc, id desc) so the
    // ordering is deterministic even when several rows share a createdAt.
    const expandIdRaw = typeof expand === "string" && /^\d+$/.test(expand) ? parseInt(expand, 10) : null;
    if (expandIdRaw != null) {
      const targetRows = await db
        .select({ id: auditLogTable.id, createdAt: auditLogTable.createdAt })
        .from(auditLogTable)
        .where(eq(auditLogTable.id, expandIdRaw))
        .limit(1);
      const target = targetRows[0];
      if (target && target.createdAt) {
        // Confirm the row matches the supplied filters before relocating;
        // otherwise it isn't on any page of this filtered view and we fall
        // back to whatever `page` the client asked for.
        const matchConditions = whereClause
          ? and(eq(auditLogTable.id, expandIdRaw), whereClause)
          : eq(auditLogTable.id, expandIdRaw);
        const matchRows = await db
          .select({ id: auditLogTable.id })
          .from(auditLogTable)
          .where(matchConditions)
          .limit(1);
        if (matchRows[0]) {
          // Count rows that come BEFORE the target under (createdAt desc, id desc):
          // either a strictly newer createdAt, or same createdAt with a larger id.
          const tieBreaker = and(eq(auditLogTable.createdAt, target.createdAt), gt(auditLogTable.id, expandIdRaw));
          const newerThanTarget = or(gt(auditLogTable.createdAt, target.createdAt), tieBreaker);
          const positionWhere = whereClause ? and(whereClause, newerThanTarget) : newerThanTarget;
          const [{ count: precedingCount } = { count: 0 }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(auditLogTable)
            .where(positionWhere);
          const preceding = Number(precedingCount || 0);
          pageNum = Math.floor(preceding / limitNum) + 1;
        }
      }
    }

    const offset = (pageNum - 1) * limitNum;

    const [logs, countResult] = await Promise.all([
      db.select().from(auditLogTable).where(whereClause).orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id)).limit(limitNum).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(auditLogTable).where(whereClause),
    ]);

    // Hide member emails/phones in queue_fallback rows for viewers without
    // PII access. Other action types are returned unchanged. The DB row is
    // never modified — only the response payload is scrubbed.
    const canSeePii = hasPermission(req.adminRole, "members:pii");
    const visibleLogs = canSeePii ? logs : logs.map(redactQueueFallbackPii);

    res.json({
      logs: visibleLogs,
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

const AUDIT_LOG_EXPORT_CAP = 10000;

router.get("/admin/audit-log/export", requirePermission("audit:view"), async (req: Request, res: Response) => {
  try {
    const { actionType, entityType, startDate, endDate, format = "csv" } = req.query;
    const conditions: any[] = [];
    if (actionType && typeof actionType === "string") conditions.push(eq(auditLogTable.actionType, actionType));
    if (entityType && typeof entityType === "string") conditions.push(eq(auditLogTable.entityType, entityType));
    if (startDate && typeof startDate === "string") conditions.push(gte(auditLogTable.createdAt, new Date(startDate)));
    if (endDate && typeof endDate === "string") conditions.push(lte(auditLogTable.createdAt, new Date(endDate)));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalMatching, logs] = await Promise.all([
      safeCount(db.select({ count: sql<number>`count(*)` }).from(auditLogTable).where(whereClause)),
      db.select().from(auditLogTable).where(whereClause).orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id)).limit(AUDIT_LOG_EXPORT_CAP),
    ]);

    const truncated = totalMatching > logs.length;
    res.setHeader("X-Audit-Log-Total-Count", String(totalMatching));
    res.setHeader("X-Audit-Log-Returned-Count", String(logs.length));
    res.setHeader("X-Audit-Log-Export-Cap", String(AUDIT_LOG_EXPORT_CAP));
    res.setHeader("X-Audit-Log-Truncated", truncated ? "true" : "false");

    const auditExposed = [
      "X-Audit-Log-Total-Count",
      "X-Audit-Log-Returned-Count",
      "X-Audit-Log-Export-Cap",
      "X-Audit-Log-Truncated",
      "Content-Disposition",
    ];
    const existingExposed = res.getHeader("Access-Control-Expose-Headers");
    const existingList = typeof existingExposed === "string"
      ? existingExposed.split(",").map(s => s.trim()).filter(Boolean)
      : [];
    const merged = Array.from(new Set([...existingList, ...auditExposed]));
    res.setHeader("Access-Control-Expose-Headers", merged.join(", "));

    // Same scrubbing as the read endpoint — exports must not leak the
    // recipient to viewers without PII access (CSV embeds the description,
    // JSON includes the full row).
    const canSeePii = hasPermission(req.adminRole, "members:pii");
    const visibleLogs = canSeePii ? logs : logs.map(redactQueueFallbackPii);

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=audit-log.json");
      res.json(visibleLogs);
    } else {
      const header = "id,actor_id,actor_email,action_type,entity_type,entity_id,description,ip_address,created_at\n";
      const rows = visibleLogs.map(l => [
        l.id,
        l.actorId,
        l.actorEmail,
        l.actionType,
        l.entityType,
        l.entityId,
        l.description,
        l.ipAddress,
        l.createdAt,
      ].map(csvEscape).join(",")).join("\n");
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

    const [products, tickets, progress, notes, auditHistory, emailHistory, emailAttemptRows] = await Promise.all([
      safeQuery(
        db.select({ id: userProductsTable.id, productId: userProductsTable.productId, status: userProductsTable.status, expiresAt: userProductsTable.expiresAt, createdAt: userProductsTable.createdAt, productName: productsTable.name, productSlug: productsTable.slug })
          .from(userProductsTable).innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id)).where(eq(userProductsTable.userId, id))
      ),
      safeQuery(db.select().from(ticketsTable).where(eq(ticketsTable.userId, id)).orderBy(desc(ticketsTable.createdAt)).limit(20)),
      safeCount(db.select({ count: sql<number>`count(*)` }).from(progressTable).where(eq(progressTable.userId, id))),
      safeQuery(db.select().from(adminNotesTable).where(eq(adminNotesTable.userId, id)).orderBy(desc(adminNotesTable.createdAt))),
      safeQuery(db.select().from(auditLogTable).where(and(eq(auditLogTable.entityType, "user"), eq(auditLogTable.entityId, String(id)))).orderBy(desc(auditLogTable.createdAt)).limit(20)),
      safeQuery(
        db.select({ id: emailChangeHistoryTable.id, oldEmail: emailChangeHistoryTable.oldEmail, newEmail: emailChangeHistoryTable.newEmail, changedAt: emailChangeHistoryTable.changedAt })
          .from(emailChangeHistoryTable)
          .where(eq(emailChangeHistoryTable.userId, id))
          .orderBy(desc(emailChangeHistoryTable.changedAt))
          .limit(50)
      ),
      safeQuery(
        db.select({
          id: emailChangeAttemptsTable.id,
          newEmail: emailChangeAttemptsTable.newEmail,
          createdAt: emailChangeAttemptsTable.createdAt,
          expiresAt: emailChangeAttemptsTable.expiresAt,
        })
          .from(emailChangeAttemptsTable)
          .where(and(
            eq(emailChangeAttemptsTable.userId, id),
            isNotNull(emailChangeAttemptsTable.newEmail),
          ))
          .orderBy(desc(emailChangeAttemptsTable.createdAt))
          .limit(50)
      ),
    ]);

    // Classify each attempt as confirmed / pending / expired / abandoned by
    // matching against `email_change_history` (confirmed) and the user's
    // current pending state.
    //
    // Confirmation matching: every new attempt overwrites the previous
    // attempt's verification token on the user record, so a confirmation can
    // only ever come from the *most recent* attempt with that target email
    // whose createdAt is at or before the history row's changedAt. We walk
    // history rows oldest-first and claim the latest eligible unclaimed
    // attempt for each one.
    const now = new Date();
    const claimedAttemptIds = new Set<number>();
    const matched = new Map<number, Date>();

    const historyAsc = [...emailHistory].sort(
      (a, b) => a.changedAt.getTime() - b.changedAt.getTime(),
    );
    const attemptsAsc = [...emailAttemptRows].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    for (const history of historyAsc) {
      const targetEmail = history.newEmail.toLowerCase();
      let bestAttemptId: number | null = null;
      let bestAttemptCreatedAt = -Infinity;
      for (const attempt of attemptsAsc) {
        if (claimedAttemptIds.has(attempt.id)) continue;
        if ((attempt.newEmail ?? "").toLowerCase() !== targetEmail) continue;
        const createdAtMs = attempt.createdAt.getTime();
        if (createdAtMs > history.changedAt.getTime()) continue;
        if (createdAtMs > bestAttemptCreatedAt) {
          bestAttemptCreatedAt = createdAtMs;
          bestAttemptId = attempt.id;
        }
      }
      if (bestAttemptId !== null) {
        claimedAttemptIds.add(bestAttemptId);
        matched.set(bestAttemptId, history.changedAt);
      }
    }

    const memberPendingEmail = member.pendingEmail?.toLowerCase() ?? null;
    const memberExpiresAtMs = member.emailChangeExpires
      ? member.emailChangeExpires.getTime()
      : null;

    const emailAttempts = emailAttemptRows.map((a) => {
      const confirmedAt = matched.get(a.id) ?? null;
      const expiresAtMs = a.expiresAt ? a.expiresAt.getTime() : null;
      let status: "pending" | "confirmed" | "expired" | "abandoned";
      if (confirmedAt) {
        status = "confirmed";
      } else if (
        memberPendingEmail &&
        memberPendingEmail === a.newEmail?.toLowerCase() &&
        memberExpiresAtMs !== null &&
        expiresAtMs !== null &&
        memberExpiresAtMs === expiresAtMs &&
        expiresAtMs > now.getTime()
      ) {
        status = "pending";
      } else if (expiresAtMs !== null && expiresAtMs <= now.getTime()) {
        status = "expired";
      } else {
        // Either superseded by a newer attempt or explicitly cancelled by
        // the member — in both cases it never resulted in a confirmed change.
        status = "abandoned";
      }
      return {
        id: a.id,
        newEmail: a.newEmail,
        requestedAt: a.createdAt.toISOString(),
        expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
        confirmedAt: confirmedAt ? confirmedAt.toISOString() : null,
        status,
      };
    });

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
      emailHistory,
      emailAttempts,
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

router.get("/admin/products", requirePermission("members:view"), async (_req: Request, res: Response) => {
  try {
    const products = await db
      .select({
        id: productsTable.id,
        slug: productsTable.slug,
        name: productsTable.name,
        type: productsTable.type,
        durationDays: productsTable.durationDays,
        priceDisplay: productsTable.priceDisplay,
        sortOrder: productsTable.sortOrder,
      })
      .from(productsTable)
      .orderBy(productsTable.sortOrder);
    res.json(products);
  } catch (error) {
    console.error("[Admin] List products error:", error);
    res.status(500).json({ error: "Failed to list products" });
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

router.post("/admin/members/:id/unlock", requirePermission("members:edit"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const [member] = await db
      .select({ id: usersTable.id, email: usersTable.email, lockedUntil: usersTable.lockedUntil, failedLoginCount: usersTable.failedLoginCount })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    // Clear both fields so the next login attempt starts from a clean slate.
    // We always run the update (even if nothing was set) so the response is
    // idempotent and the audit trail records the admin's intent either way.
    await db
      .update(usersTable)
      .set({ lockedUntil: null, failedLoginCount: 0 })
      .where(eq(usersTable.id, id));

    await logAdminAction(
      req,
      "unlock_account",
      "user",
      String(id),
      `Unlocked account for member ${member.email} (cleared lockedUntil and failedLoginCount)`,
      {
        before: { lockedUntil: member.lockedUntil, failedLoginCount: member.failedLoginCount },
        after: { lockedUntil: null, failedLoginCount: 0 },
      },
    );

    res.json({ success: true, id, lockedUntil: null, failedLoginCount: 0 });
  } catch (error) {
    console.error("[Admin] Unlock account error:", error);
    res.status(500).json({ error: "Failed to unlock account" });
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
      const csvRows = data.map(row => Object.values(row).map(csvEscape).join(",")).join("\n");
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

    const [userCount, ticketCount, recentAuditLogs, redisConnected] = await Promise.all([
      safeCount(db.select({ count: sql<number>`count(*)` }).from(usersTable)),
      safeCount(db.select({ count: sql<number>`count(*)` }).from(ticketsTable)),
      safeCount(db.select({ count: sql<number>`count(*)` }).from(auditLogTable).where(gte(auditLogTable.createdAt, new Date(Date.now() - 86400000)))),
      isRedisConnected().catch(() => false),
    ]);

    const queueFallbacks = await getQueueFallbackStatsFromDb();
    const redisStatus = !redisConnected
      ? "down"
      : queueFallbacks.alerting
        ? "degraded"
        : "up";

    const overallStatus = !dbOk || queueFallbacks.alerting || !redisConnected
      ? "degraded"
      : "healthy";

    res.json({
      status: overallStatus,
      services: {
        api: { status: "up", uptime: process.uptime() },
        database: { status: dbOk ? "up" : "down", totalUsers: userCount, totalTickets: ticketCount },
        redis: { status: redisStatus, queueFallbacks },
        signupChallenge: { enforced: isSignupChallengeEnforced() },
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

/**
 * Recent queue-fallback events from the audit log.
 *
 * The System Health card already shows aggregate counts (5m / 1h / 24h) but
 * those numbers don't help an on-call investigating a Redis outage figure
 * out *which* sends fell through. This endpoint returns the actual rows so
 * the System Health page can render them as a timeline, with each entry
 * deep-linking back to the matching audit log row for the full context
 * (IP, actor, raw metadata).
 *
 * Query params:
 *   - limit: number of events to return (default 50, max 200)
 *
 * Filters by `actionType = "queue_fallback"` and `entityType = "queue"` so
 * the list lines up 1:1 with the counts in `getQueueFallbackStatsFromDb`
 * (which uses the same filter). Each fallback writes exactly one row with
 * this entityType; the filter is also belt-and-braces protection against
 * any older `entityType = "communication"` rows still sitting in the table
 * from before that duplicate write was removed.
 */
router.get("/admin/system/queue-fallback-events", requirePermission("system:view"), async (req: Request, res: Response) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

    const rows = await db
      .select({
        id: auditLogTable.id,
        createdAt: auditLogTable.createdAt,
        entityId: auditLogTable.entityId,
        description: auditLogTable.description,
        metadata: auditLogTable.metadata,
      })
      .from(auditLogTable)
      .where(and(eq(auditLogTable.actionType, "queue_fallback"), eq(auditLogTable.entityType, "queue")))
      .orderBy(desc(auditLogTable.createdAt))
      .limit(limit);

    const events = rows.map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const channelRaw = typeof meta.channel === "string" ? meta.channel : row.entityId;
      const channel = channelRaw === "email" || channelRaw === "sms" ? channelRaw : null;
      const recipient = typeof meta.recipient === "string" && meta.recipient.length > 0 ? meta.recipient : null;
      const reason = typeof meta.reason === "string" && meta.reason.length > 0 ? meta.reason : null;
      return {
        id: row.id,
        createdAt: row.createdAt,
        channel,
        recipient,
        reason,
        description: row.description,
      };
    });

    res.json({ events, limit });
  } catch (error) {
    console.error("[Admin] Queue fallback events error:", error);
    res.status(500).json({ error: "Failed to fetch queue fallback events" });
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

    const queueFallbacks = await getQueueFallbackStatsFromDb();
    if (queueFallbacks.alerting) {
      const recent = queueFallbacks.email.recentCount + queueFallbacks.sms.recentCount;
      const lastAt = [queueFallbacks.email.lastAt, queueFallbacks.sms.lastAt]
        .filter((v): v is string => Boolean(v))
        .sort()
        .pop() ?? new Date().toISOString();
      notifications.push({
        id: "queue-fallback",
        type: "queue_fallback",
        severity: "high",
        title: "Email/SMS queue is bypassing Redis",
        message: `Direct-send fallback fired ${recent}x in the last few minutes — Redis or the worker may be unhealthy.`,
        link: "/admin/system",
        createdAt: lastAt,
      });
    }

    // Production-only: surface a missing Turnstile secret as a high-severity
    // notification so admins notice without having to open System Health.
    // Outside production an unset secret is normal (local dev / CI) and we
    // stay quiet. Also fan out to the on-call alert pipeline — that path
    // throttles itself so this fires at most once per channel per window
    // even though /admin/notifications is polled every minute.
    if (process.env.NODE_ENV === "production" && !isSignupChallengeEnforced()) {
      notifications.push({
        id: "signup-challenge-disabled",
        type: "signup_challenge_disabled",
        severity: "high",
        title: "Signup challenge disabled in production",
        message:
          "TURNSTILE_SECRET_KEY is not set, so signup requests are passing through without Cloudflare Turnstile verification. Set it on the API service to restore enforcement.",
        link: "/admin/system",
        createdAt: new Date().toISOString(),
      });
      // Don't await — alerting on the dashboard fetch path shouldn't block
      // the response, and the alerter logs its own errors.
      evaluateSignupChallengeAlert().catch((err) => {
        console.error("[Admin] signup-challenge alerter dispatch failed:", err);
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
