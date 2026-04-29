import { Router, type Request, type Response } from "express";
import { db, usersTable, userProductsTable, productsTable, ticketsTable, auditLogTable, systemSettingsTable, adminNotesTable, progressTable, emailChangeHistoryTable, emailChangeAttemptsTable, phoneChangeHistoryTable } from "@workspace/db";
import { eq, and, gt, gte, lt, lte, desc, asc, sql, ilike, or, isNotNull, type SQL } from "drizzle-orm";
import { hasPermission, requirePermission } from "../middleware/rbac";
import { isSignupChallengeEnforced } from "../middleware/captcha";
import { logAdminAction, redactAuditRowPii } from "../lib/audit-log";
import { CommunicationService } from "../lib/communication-service";
import { isRedisConnected } from "../lib/redis";
import { getQueueFallbackStatsFromDb } from "../lib/queue-fallback-tracker";
import { getAbuseRateLimitCleanupStatus } from "../lib/abuse-rate-limit-cleanup";
import { getRateLimitAuditFailureStats } from "../lib/rate-limit-audit-failure-tracker";
import { evaluateSignupChallengeAlert } from "../lib/signup-challenge-alerter";
import {
  evaluateProductionEnvGuards,
  getMisconfiguredCriticalSecrets,
} from "../lib/production-env-guard";
import { AUTH_RATE_LIMIT_AUDIT_ACTION } from "./auth";
import {
  getOnCallDestinationsStatus,
  setOnCallDestination,
  isOnCallSettingKey,
  type OnCallField,
} from "../lib/oncall-settings";
import {
  sendOnCallTestAlert,
  QUEUE_FALLBACK_ALERT_ACTION_TYPE,
  QUEUE_FALLBACK_ALERT_ENTITY_TYPE,
} from "../lib/queue-fallback-alerter";
import jwt from "jsonwebtoken";

const router = Router();

// "Needs Attention" surfaces a burst of `auth_rate_limit_blocked` audit rows so
// admins can react to a credential-stuffing wave without polling the audit log.
// The threshold and window are intentionally modest defaults — tuning them is
// a follow-up if false positives become noisy.
const AUTH_RATE_LIMIT_ALERT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_ALERT_THRESHOLD = 10;
// If a single source IP accounts for at least this fraction of the burst, we
// call it out by name in the alert so the on-call admin can immediately tell
// whether they're looking at a focused attack or a broader spray.
const AUTH_RATE_LIMIT_DOMINANT_IP_RATIO = 0.6;
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

// Page sizes for the admin Member Detail "Email change attempts" card. The
// initial render embeds the most recent page in `/admin/members/:id/full`;
// older attempts are paged in via `/admin/members/:id/email-attempts` so
// support staff can reach attempts that fall outside the first page within
// the current 90-day retention window.
const EMAIL_ATTEMPTS_DEFAULT_PAGE_SIZE = 50;
const EMAIL_ATTEMPTS_MAX_PAGE_SIZE = 100;
// Safety cap on in-memory classification: with a 90-day retention window and
// per-member email-change rate limits, real members never approach this many
// rows. The cap exists purely to keep a misconfigured account from OOMing the
// admin endpoint.
const EMAIL_ATTEMPT_CLASSIFICATION_CAP = 1000;
const EMAIL_HISTORY_CLASSIFICATION_CAP = 1000;
// Cap on the embedded `emailHistory` array returned by `/full`. Older
// history rows are still considered when classifying attempts, but only
// the most recent page is rendered on the Member Detail page.
const EMAIL_HISTORY_RESPONSE_PAGE_SIZE = 50;

type RawEmailAttempt = {
  id: number;
  newEmail: string | null;
  createdAt: Date;
  expiresAt: Date | null;
};

type RawEmailHistory = {
  id: number;
  oldEmail: string;
  newEmail: string;
  changedAt: Date;
};

export type ClassifiedEmailAttempt = {
  id: number;
  newEmail: string | null;
  requestedAt: string;
  expiresAt: string | null;
  confirmedAt: string | null;
  status: "pending" | "confirmed" | "expired" | "abandoned";
};

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
//
// Output preserves the order of `attemptRows` (callers pass DESC so the
// returned list is also DESC).
export function classifyEmailAttempts(
  attemptRows: RawEmailAttempt[],
  historyRows: RawEmailHistory[],
  member: { pendingEmail: string | null; emailChangeExpires: Date | null },
  now: Date = new Date(),
): ClassifiedEmailAttempt[] {
  const claimedAttemptIds = new Set<number>();
  const matched = new Map<number, Date>();

  const historyAsc = [...historyRows].sort(
    (a, b) => a.changedAt.getTime() - b.changedAt.getTime(),
  );
  const attemptsAsc = [...attemptRows].sort(
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
  const nowMs = now.getTime();

  return attemptRows.map((a) => {
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
      expiresAtMs > nowMs
    ) {
      status = "pending";
    } else if (expiresAtMs !== null && expiresAtMs <= nowMs) {
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

    // Detect a burst of auth rate-limit hits in the last 15 minutes. We group
    // by ip_address in a single query so we can both count the total and
    // identify a dominant source IP without a second round-trip. The query
    // is wrapped in `safeQuery` so a transient DB error degrades to "no
    // alert" instead of breaking the whole panel.
    const rateLimitWindowStart = new Date(now.getTime() - AUTH_RATE_LIMIT_ALERT_WINDOW_MS);
    const rateLimitWindowMinutes = Math.round(AUTH_RATE_LIMIT_ALERT_WINDOW_MS / 60000);
    const rateLimitGroups = await safeQuery(
      db
        .select({
          ip: auditLogTable.ipAddress,
          count: sql<number>`count(*)`,
        })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION),
            gte(auditLogTable.createdAt, rateLimitWindowStart),
          ),
        )
        .groupBy(auditLogTable.ipAddress),
      [] as Array<{ ip: string | null; count: number }>,
    );
    const rateLimitTotal = rateLimitGroups.reduce((sum, row) => sum + Number(row.count || 0), 0);
    if (rateLimitTotal >= AUTH_RATE_LIMIT_ALERT_THRESHOLD) {
      let dominantIp: string | null = null;
      let dominantCount = 0;
      for (const row of rateLimitGroups) {
        const c = Number(row.count || 0);
        if (row.ip && c > dominantCount) {
          dominantIp = row.ip;
          dominantCount = c;
        }
      }
      const dominantShare = rateLimitTotal > 0 ? dominantCount / rateLimitTotal : 0;
      const ipSuffix =
        dominantIp && dominantShare >= AUTH_RATE_LIMIT_DOMINANT_IP_RATIO
          ? ` — ${dominantCount} from ${dominantIp}`
          : "";
      alerts.push({
        type: "auth_rate_limit_burst",
        severity: "high",
        title: "Auth rate-limit burst",
        description: `${rateLimitTotal} auth rate-limit hits in the last ${rateLimitWindowMinutes} minutes${ipSuffix}`,
        link: `/admin/audit-log?actionType=${AUTH_RATE_LIMIT_AUDIT_ACTION}`,
      });
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
      .where(or(ilike(usersTable.name, searchPattern), ilike(usersTable.email, searchPattern), ilike(usersTable.phone, searchPattern)))
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

    const previousPhoneMatches = await safeQuery(
      db.select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        oldPhone: phoneChangeHistoryTable.oldPhone,
        changedAt: phoneChangeHistoryTable.changedAt,
      })
        .from(phoneChangeHistoryTable)
        .innerJoin(usersTable, eq(phoneChangeHistoryTable.userId, usersTable.id))
        .where(ilike(phoneChangeHistoryTable.oldPhone, searchPattern))
        .orderBy(desc(phoneChangeHistoryTable.changedAt))
        .limit(20)
    );

    const directIds = new Set(directMembers.map((m) => m.id));
    const seenPreviousIds = new Set<number>();
    const previousOnlyMembers: Array<{ id: number; name: string; email: string; role: string; matchedPreviousEmail?: string; matchedPreviousPhone?: string }> = [];
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
    for (const row of previousPhoneMatches) {
      if (directIds.has(row.id) || seenPreviousIds.has(row.id)) continue;
      seenPreviousIds.add(row.id);
      previousOnlyMembers.push({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        matchedPreviousPhone: row.oldPhone,
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

// Cursor format used by /admin/audit-log keyset pagination. We encode the
// (createdAt, id) tuple of an anchor row as base64url JSON. The cursor is
// opaque to clients — they only ever round-trip values produced by the
// server. `t` is the anchor's createdAt as ms-since-epoch and `i` is its
// numeric id; together they form the (created_at, id) tuple that the
// (audit_log_created_at_id_idx) composite index walks.

type AuditCursor = { t: number; i: number };

function encodeAuditCursor(c: AuditCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeAuditCursor(raw: unknown): AuditCursor | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!json || typeof json !== "object") return null;
    const t = Number((json as Record<string, unknown>).t);
    const i = Number((json as Record<string, unknown>).i);
    if (!Number.isFinite(t) || !Number.isInteger(i) || i <= 0) return null;
    return { t, i };
  } catch {
    return null;
  }
}

// Build a row-tuple comparison predicate. We can't rely on the SQL row
// constructor (`(created_at, id) < (?, ?)`) compiling cleanly through every
// driver path, so we expand the lexicographic compare by hand:
//   strict_left  OR  (equal AND strict_inner)
// where `equal` is (created_at = anchor.t) and `strict_inner` is the id
// compare. This still uses the (created_at, id) btree because the planner
// recognizes the equality + inequality split.
function olderThanCursor(c: AuditCursor) {
  const anchor = new Date(c.t);
  return or(
    lt(auditLogTable.createdAt, anchor),
    and(eq(auditLogTable.createdAt, anchor), lt(auditLogTable.id, c.i)),
  )!;
}

function newerThanCursor(c: AuditCursor) {
  const anchor = new Date(c.t);
  return or(
    gt(auditLogTable.createdAt, anchor),
    and(eq(auditLogTable.createdAt, anchor), gt(auditLogTable.id, c.i)),
  )!;
}

function olderOrEqualToCursor(c: AuditCursor) {
  const anchor = new Date(c.t);
  return or(
    lt(auditLogTable.createdAt, anchor),
    and(eq(auditLogTable.createdAt, anchor), lte(auditLogTable.id, c.i)),
  )!;
}

function rowToCursor(row: { createdAt: Date | null; id: number }): AuditCursor | null {
  if (!row.createdAt) return null;
  return { t: row.createdAt.getTime(), i: row.id };
}

router.get("/admin/audit-log", requirePermission("audit:view"), async (req: Request, res: Response) => {
  try {
    const { actionType, entityType, actorId, startDate, endDate, page, limit = "50", expand, cursor, direction, jumpTo } = req.query;

    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));

    const conditions: any[] = [];
    if (actionType && typeof actionType === "string") conditions.push(eq(auditLogTable.actionType, actionType));
    if (entityType && typeof entityType === "string") conditions.push(eq(auditLogTable.entityType, entityType));
    if (actorId && typeof actorId === "string") conditions.push(eq(auditLogTable.actorId, parseInt(actorId, 10)));
    if (startDate && typeof startDate === "string") conditions.push(gte(auditLogTable.createdAt, new Date(startDate)));
    if (endDate && typeof endDate === "string") conditions.push(lte(auditLogTable.createdAt, new Date(endDate)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const canSeePii = hasPermission(req.adminRole, "members:pii");
    const sanitize = (rows: any[]) => (canSeePii ? rows : rows.map(redactAuditRowPii));

    const expandIdRaw = typeof expand === "string" && /^\d+$/.test(expand) ? parseInt(expand, 10) : null;
    const decodedCursor = decodeAuditCursor(cursor);
    const cursorDirection: "forward" | "backward" = direction === "backward" ? "backward" : "forward";

    // "Jump to date/time": parse a client-supplied timestamp into a synthetic
    // anchor that can ride the (created_at, id) keyset path. Invalid values
    // are dropped silently so the request still renders the default newest
    // page instead of failing.
    const jumpToDate = (() => {
      if (typeof jumpTo !== "string" || jumpTo.length === 0) return null;
      const d = new Date(jumpTo);
      return Number.isNaN(d.getTime()) ? null : d;
    })();

    // ---- expand=<id> deep-link (O(log n + page_size)) --------------------
    // Look up the target row's (createdAt, id), confirm filters, then walk
    // the (created_at, id) index in both directions to assemble a window
    // centered on the target. No count(*) over the prefix is performed.
    if (expandIdRaw != null) {
      const [target] = await db
        .select({ id: auditLogTable.id, createdAt: auditLogTable.createdAt })
        .from(auditLogTable)
        .where(eq(auditLogTable.id, expandIdRaw))
        .limit(1);

      if (target && target.createdAt) {
        const matchWhere = whereClause
          ? and(eq(auditLogTable.id, expandIdRaw), whereClause)
          : eq(auditLogTable.id, expandIdRaw);
        const [matched] = await db
          .select({ id: auditLogTable.id })
          .from(auditLogTable)
          .where(matchWhere)
          .limit(1);

        if (matched) {
          const targetCursor: AuditCursor = { t: target.createdAt.getTime(), i: target.id };
          const half = Math.floor(limitNum / 2);

          // Newer half: rows strictly newer than the target. Fetch one extra
          // to detect whether more newer rows exist (drives the prevCursor).
          const newerWhere = whereClause
            ? and(whereClause, newerThanCursor(targetCursor))
            : newerThanCursor(targetCursor);
          const newerLookup = half > 0
            ? await db.select().from(auditLogTable).where(newerWhere)
                .orderBy(asc(auditLogTable.createdAt), asc(auditLogTable.id))
                .limit(half + 1)
            : [];
          const hasMoreNewer = newerLookup.length > half;
          const newerRows = (hasMoreNewer ? newerLookup.slice(0, half) : newerLookup).reverse();

          // Older half: target row + rows strictly older. Fetch one extra
          // to detect whether more older rows exist (drives the nextCursor).
          const remaining = limitNum - newerRows.length;
          const olderWhere = whereClause
            ? and(whereClause, olderOrEqualToCursor(targetCursor))
            : olderOrEqualToCursor(targetCursor);
          const olderLookup = await db.select().from(auditLogTable).where(olderWhere)
            .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
            .limit(remaining + 1);
          const hasMoreOlder = olderLookup.length > remaining;
          const olderRows = hasMoreOlder ? olderLookup.slice(0, remaining) : olderLookup;

          const logs = [...newerRows, ...olderRows];
          const first = logs[0];
          const last = logs[logs.length - 1];

          // Single COUNT(*) over the active filters so the UI can show
          // "N matching" alongside the export buttons. This runs once per
          // filter change (the deep-link path is a first fetch); follow-up
          // cursor pagination skips it.
          const total = await safeCount(
            db.select({ count: sql<number>`count(*)` }).from(auditLogTable).where(whereClause),
          );

          res.json({
            logs: sanitize(logs),
            pagination: { page: null, limit: limitNum, total, totalPages: null },
            exportCap: resolveAuditLogExportHardCap(),
            cursors: {
              next: hasMoreOlder && last ? encodeAuditCursor(rowToCursor(last)!) : null,
              prev: hasMoreNewer && first ? encodeAuditCursor(rowToCursor(first)!) : null,
            },
            expand: { targetId: expandIdRaw, found: true },
          });
          return;
        }
      }
      // Target row missing or filtered out — fall through to the normal
      // listing so the page still renders something coherent.
    }

    // ---- jumpTo=<iso> deep-jump (O(log n + page_size)) -------------------
    // "Jump to a specific date/time": find matching rows at-or-before the
    // chosen timestamp using the (created_at, id) index and render a page
    // anchored there (newest at the top of the page = first row at-or-before
    // jumpTo). This is the cursor-era replacement for "page 1000": no offset
    // math, no count of skipped rows. A synthetic anchor with i =
    // MAX_SAFE_INTEGER lets olderOrEqualToCursor return rows at any id on
    // the boundary timestamp. Cursor takes precedence so the regular
    // Newer/Older buttons keep working after the initial jump.
    if (jumpToDate && !decodedCursor && expandIdRaw == null) {
      // Audit row ids are int4 in Postgres, so the synthetic anchor uses
      // the int4 max (2^31 - 1) instead of MAX_SAFE_INTEGER. Anything
      // larger trips "value out of range for type integer" on the bind.
      const anchor: AuditCursor = { t: jumpToDate.getTime(), i: 2_147_483_647 };
      const olderWhere = whereClause
        ? and(whereClause, olderOrEqualToCursor(anchor))
        : olderOrEqualToCursor(anchor);
      const olderLookup = await db.select().from(auditLogTable).where(olderWhere)
        .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
        .limit(limitNum + 1);
      const hasMoreOlder = olderLookup.length > limitNum;
      const window = hasMoreOlder ? olderLookup.slice(0, limitNum) : olderLookup;
      const first = window[0];
      const last = window[window.length - 1];

      // Probe whether any row exists strictly newer than the anchor (or the
      // top of the window if it's non-empty) so the UI can offer "Newer".
      // Cheap (LIMIT 1) lookup against the same composite index.
      const probeAnchor = first ? rowToCursor(first) : anchor;
      let hasNewer = false;
      if (probeAnchor) {
        const probeWhere = whereClause
          ? and(whereClause, newerThanCursor(probeAnchor))
          : newerThanCursor(probeAnchor);
        const probe = await db
          .select({ id: auditLogTable.id })
          .from(auditLogTable)
          .where(probeWhere)
          .limit(1);
        hasNewer = probe.length > 0;
      }

      // Single COUNT(*) so the UI can show "N matching" alongside exports —
      // matches the behaviour of the first-page and expand= branches.
      const total = await safeCount(
        db.select({ count: sql<number>`count(*)` }).from(auditLogTable).where(whereClause),
      );

      res.json({
        logs: sanitize(window),
        pagination: { page: null, limit: limitNum, total, totalPages: null },
        exportCap: AUDIT_LOG_EXPORT_CAP,
        cursors: {
          next: hasMoreOlder && last ? encodeAuditCursor(rowToCursor(last)!) : null,
          // If the window is empty (jumped before any matching rows exist)
          // fall back to the synthetic anchor so the user can still walk
          // toward newer rows from the chosen instant.
          prev: hasNewer
            ? encodeAuditCursor(first ? rowToCursor(first)! : anchor)
            : null,
        },
        jumpTo: { requested: jumpToDate.toISOString(), found: window.length > 0 },
      });
      return;
    }

    // ---- cursor-based pagination (preferred, O(log n + page_size)) --------
    if (decodedCursor) {
      if (cursorDirection === "backward") {
        // "Newer" page: walk ascending from the cursor, then reverse for the
        // newest-first display order. Look one row past the limit to detect
        // whether further newer rows exist.
        const where = whereClause
          ? and(whereClause, newerThanCursor(decodedCursor))
          : newerThanCursor(decodedCursor);
        const rows = await db.select().from(auditLogTable).where(where)
          .orderBy(asc(auditLogTable.createdAt), asc(auditLogTable.id))
          .limit(limitNum + 1);
        const hasMoreNewer = rows.length > limitNum;
        const window = (hasMoreNewer ? rows.slice(0, limitNum) : rows).reverse();
        const first = window[0];
        const last = window[window.length - 1];
        res.json({
          logs: sanitize(window),
          pagination: { page: null, limit: limitNum, total: null, totalPages: null },
          exportCap: resolveAuditLogExportHardCap(),
          cursors: {
            // We arrived from a newer cursor, so older rows definitely exist
            // past the bottom of this page — return their cursor so the UI
            // can offer "Older". For "Newer" we rely on the look-ahead.
            next: last ? encodeAuditCursor(rowToCursor(last)!) : null,
            prev: hasMoreNewer && first ? encodeAuditCursor(rowToCursor(first)!) : null,
          },
        });
        return;
      }

      // Forward (older) page: descending walk from the cursor.
      const where = whereClause
        ? and(whereClause, olderThanCursor(decodedCursor))
        : olderThanCursor(decodedCursor);
      const rows = await db.select().from(auditLogTable).where(where)
        .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
        .limit(limitNum + 1);
      const hasMoreOlder = rows.length > limitNum;
      const window = hasMoreOlder ? rows.slice(0, limitNum) : rows;
      const first = window[0];
      const last = window[window.length - 1];
      res.json({
        logs: sanitize(window),
        pagination: { page: null, limit: limitNum, total: null, totalPages: null },
        exportCap: resolveAuditLogExportHardCap(),
        cursors: {
          next: hasMoreOlder && last ? encodeAuditCursor(rowToCursor(last)!) : null,
          // We arrived from an older direction, so newer rows definitely
          // exist above the top of this page.
          prev: first ? encodeAuditCursor(rowToCursor(first)!) : null,
        },
      });
      return;
    }

    // ---- No cursor: either the very first page (default behaviour) or
    // legacy `?page=N` offset pagination for old clients. Cursor mode is
    // preferred and is what the portal UI uses now; the offset path keeps
    // working for any external caller that still passes `page`.

    if (page !== undefined) {
      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const offset = (pageNum - 1) * limitNum;
      const [rows, countResult] = await Promise.all([
        db.select().from(auditLogTable).where(whereClause)
          .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
          .limit(limitNum).offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(auditLogTable).where(whereClause),
      ]);
      const total = Number(countResult[0]?.count || 0);
      const first = rows[0];
      const last = rows[rows.length - 1];
      res.json({
        logs: sanitize(rows),
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
        exportCap: resolveAuditLogExportHardCap(),
        cursors: {
          next: rows.length === limitNum && pageNum * limitNum < total && last
            ? encodeAuditCursor(rowToCursor(last)!)
            : null,
          prev: pageNum > 1 && first ? encodeAuditCursor(rowToCursor(first)!) : null,
        },
      });
      return;
    }

    // First page in cursor mode — no anchor yet, so just take the newest N.
    // We also run a single COUNT(*) for the active filters so the UI can
    // surface "N matching" alongside the export buttons. This only fires on
    // filter changes (the cursor branches above stay count-free).
    const [rows, totalForFilters] = await Promise.all([
      db.select().from(auditLogTable).where(whereClause)
        .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
        .limit(limitNum + 1),
      safeCount(db.select({ count: sql<number>`count(*)` }).from(auditLogTable).where(whereClause)),
    ]);
    const hasMoreOlder = rows.length > limitNum;
    const window = hasMoreOlder ? rows.slice(0, limitNum) : rows;
    const last = window[window.length - 1];
    res.json({
      logs: sanitize(window),
      pagination: { page: null, limit: limitNum, total: totalForFilters, totalPages: null },
      exportCap: resolveAuditLogExportHardCap(),
      cursors: {
        next: hasMoreOlder && last ? encodeAuditCursor(rowToCursor(last)!) : null,
        prev: null,
      },
    });
  } catch (error) {
    console.error("[Admin] Audit log error:", error);
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

// We page through the matching audit rows in chunks of this size and stream
// each chunk to the response as we go. This keeps memory use bounded
// regardless of how broad an admin's filters are — a year of activity that
// previously hit the 10,000 row truncation cap now exports in full without
// holding the whole result set in memory at once. The size is a balance:
// larger batches mean fewer round-trips to Postgres but more memory per
// batch and longer pauses between writes; 1,000 keeps both modest.
const AUDIT_LOG_EXPORT_BATCH_SIZE = 1000;

// Hard ceiling on how many rows a single export call will write. Streaming
// removes the memory ceiling that the old LIMIT 10000 implicitly enforced,
// but a wide-open export against a multi-million-row table can still tie up
// the server for a long time. The cap is generous (1M rows) by default so
// real-world admin exports never hit it; it exists to bound runaway queries.
// Tests override it via env to exercise the truncation path without seeding
// a million rows.
const DEFAULT_AUDIT_LOG_EXPORT_HARD_CAP = 1_000_000;
function resolveAuditLogExportHardCap(): number {
  const raw = process.env.AUDIT_LOG_EXPORT_HARD_CAP;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return DEFAULT_AUDIT_LOG_EXPORT_HARD_CAP;
}

// Microsecond-precision keyset cursor. We can't reuse the (created_at, id)
// cursor type from the read endpoint because that one truncates createdAt
// to JS millisecond precision — fine for human paging, but for a full
// export it silently drops every row whose stored createdAt has any
// sub-millisecond component (Postgres `now()` returns microsecond
// precision). Instead we read createdAt as a microsecond ISO string from
// the row itself (`to_char(... 'US')`) and feed that string straight back
// into the next batch's WHERE clause as a `timestamptz` parameter. The
// string is never round-tripped through a JS Date, so no precision is lost.
type ExportCursor = { ts: string; id: number };

router.get("/admin/audit-log/export", requirePermission("audit:view"), async (req: Request, res: Response) => {
  const { actionType, entityType, startDate, endDate, format = "csv" } = req.query;
  const conditions: any[] = [];
  if (actionType && typeof actionType === "string") conditions.push(eq(auditLogTable.actionType, actionType));
  if (entityType && typeof entityType === "string") conditions.push(eq(auditLogTable.entityType, entityType));
  if (startDate && typeof startDate === "string") conditions.push(gte(auditLogTable.createdAt, new Date(startDate)));
  if (endDate && typeof endDate === "string") conditions.push(lte(auditLogTable.createdAt, new Date(endDate)));
  const baseWhere = conditions.length > 0 ? and(...conditions) : undefined;
  const hardCap = resolveAuditLogExportHardCap();

  try {
    // Same scrubbing as the read endpoint — exports must not leak the
    // recipient to viewers without PII access (CSV embeds the description,
    // JSON includes the full row).
    const canSeePii = hasPermission(req.adminRole, "members:pii");
    const sanitize = (row: any) => (canSeePii ? row : redactAuditRowPii(row));

    // We deliberately do NOT issue an upfront `count(*)` against the
    // filtered set: on a multi-million-row audit_log that count is the
    // dominant cost (often dwarfing the actual data fetch). Instead we
    // walk the (created_at, id) keyset in chunks and report the total
    // rows actually written via an HTTP trailer once the stream finishes.
    // Truncation is signalled by a separate trailer when the hard cap is
    // hit. Trailers are declared up front so well-behaved clients can
    // surface the values; browsers that ignore trailers still get a
    // complete (or correctly-truncated) download in the body.
    res.setHeader("Trailer", "X-Audit-Log-Returned-Count, X-Audit-Log-Truncated");

    const auditExposed = [
      "Content-Disposition",
      "Trailer",
      "X-Audit-Log-Returned-Count",
      "X-Audit-Log-Truncated",
    ];
    const existingExposed = res.getHeader("Access-Control-Expose-Headers");
    const existingList = typeof existingExposed === "string"
      ? existingExposed.split(",").map(s => s.trim()).filter(Boolean)
      : [];
    const merged = Array.from(new Set([...existingList, ...auditExposed]));
    res.setHeader("Access-Control-Expose-Headers", merged.join(", "));

    const isJson = format === "json";
    if (isJson) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=audit-log.json");
      res.write("[");
    } else {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=audit-log.csv");
      res.write("id,actor_id,actor_email,action_type,entity_type,entity_id,description,ip_address,created_at\n");
    }

    let cursor: ExportCursor | null = null;
    let firstRow = true;
    let aborted = false;
    let written = 0;
    let truncated = false;
    res.on("close", () => {
      if (!res.writableEnded) aborted = true;
    });

    // Microsecond-precision ISO of the row's createdAt, used as the next
    // batch's keyset anchor. Stored as a SELECT alias rather than computed
    // in JS so we keep the stored microsecond component intact.
    const cursorTsExpr = sql<string>`to_char(${auditLogTable.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

    while (!aborted && written < hardCap) {
      // Honour the hard cap by capping batch size at the remaining budget,
      // and ask for one extra row when we're at the boundary so we can
      // detect "more rows past the cap" without an extra count query.
      const remaining = hardCap - written;
      const batchSize = Math.min(AUDIT_LOG_EXPORT_BATCH_SIZE, remaining);
      const isFinalBatch = remaining <= AUDIT_LOG_EXPORT_BATCH_SIZE;
      const fetchSize = isFinalBatch ? batchSize + 1 : batchSize;

      // Build the cursor predicate by hand (rather than a row-tuple SQL
      // constructor) so the planner can split it into the equality and
      // strict-less branches the (created_at, id) btree understands. We
      // bind the cursor timestamp as a string and explicitly cast to
      // timestamptz so Postgres compares with full microsecond precision.
      const cursorClause: SQL | undefined = cursor
        ? sql`(${auditLogTable.createdAt} < ${cursor.ts}::timestamptz OR (${auditLogTable.createdAt} = ${cursor.ts}::timestamptz AND ${auditLogTable.id} < ${cursor.id}))`
        : undefined;
      const whereClause: SQL | undefined = baseWhere && cursorClause
        ? and(baseWhere, cursorClause)
        : (cursorClause ?? baseWhere);

      // Explicit row type — Drizzle's inferred type for the select would
      // cycle through `cursor`'s reassignment below and trigger TS7022.
      type ExportRow = typeof auditLogTable.$inferSelect & { cursorTs: string };

      const rows: ExportRow[] = await db
        .select({
          id: auditLogTable.id,
          actorId: auditLogTable.actorId,
          actorEmail: auditLogTable.actorEmail,
          actionType: auditLogTable.actionType,
          entityType: auditLogTable.entityType,
          entityId: auditLogTable.entityId,
          description: auditLogTable.description,
          changeDiff: auditLogTable.changeDiff,
          ipAddress: auditLogTable.ipAddress,
          userAgent: auditLogTable.userAgent,
          metadata: auditLogTable.metadata,
          createdAt: auditLogTable.createdAt,
          cursorTs: cursorTsExpr,
        })
        .from(auditLogTable)
        .where(whereClause)
        .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
        .limit(fetchSize);

      if (rows.length === 0) break;

      // The peek-ahead row (when present on the final batch) is the
      // signal that more rows would have followed past the cap. We
      // never write it to the response.
      const writeCount = Math.min(rows.length, batchSize);
      if (isFinalBatch && rows.length > batchSize) truncated = true;

      for (let i = 0; i < writeCount; i++) {
        const { cursorTs: _omit, ...raw } = rows[i];
        const row = sanitize(raw);
        if (isJson) {
          res.write(firstRow ? JSON.stringify(row) : "," + JSON.stringify(row));
        } else {
          const line = [
            row.id,
            row.actorId,
            row.actorEmail,
            row.actionType,
            row.entityType,
            row.entityId,
            row.description,
            row.ipAddress,
            row.createdAt,
          ].map(csvEscape).join(",");
          res.write(firstRow ? line : "\n" + line);
        }
        firstRow = false;
        written++;
      }

      const lastWritten: ExportRow = rows[writeCount - 1];
      cursor = { ts: lastWritten.cursorTs, id: lastWritten.id };

      // Natural exhaustion (the DB had nothing past this batch) or we've
      // hit the cap — stop walking.
      if (rows.length < fetchSize) break;
      if (truncated || written >= hardCap) break;
    }

    if (isJson) res.write("]");
    if (!aborted) {
      const trailers: Record<string, string> = {
        "X-Audit-Log-Returned-Count": String(written),
      };
      if (truncated) trailers["X-Audit-Log-Truncated"] = "true";
      res.addTrailers(trailers);
    }
    res.end();
  } catch (error) {
    console.error("[Admin] Audit log export error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to export audit log" });
    } else {
      // Headers are already on the wire — best we can do is hang up so the
      // client sees a truncated download instead of a silently-complete one.
      res.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }
});

router.get("/admin/members/:id/full", requirePermission("members:view"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const [member] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    const [products, tickets, progress, notes, auditHistory, emailHistoryFull, emailAttemptRowsFull, phoneHistory] = await Promise.all([
      safeQuery(
        db.select({ id: userProductsTable.id, productId: userProductsTable.productId, status: userProductsTable.status, expiresAt: userProductsTable.expiresAt, createdAt: userProductsTable.createdAt, productName: productsTable.name, productSlug: productsTable.slug })
          .from(userProductsTable).innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id)).where(eq(userProductsTable.userId, id))
      ),
      safeQuery(db.select().from(ticketsTable).where(eq(ticketsTable.userId, id)).orderBy(desc(ticketsTable.createdAt)).limit(20)),
      safeCount(db.select({ count: sql<number>`count(*)` }).from(progressTable).where(eq(progressTable.userId, id))),
      safeQuery(db.select().from(adminNotesTable).where(eq(adminNotesTable.userId, id)).orderBy(desc(adminNotesTable.createdAt))),
      safeQuery(db.select().from(auditLogTable).where(and(eq(auditLogTable.entityType, "user"), eq(auditLogTable.entityId, String(id)))).orderBy(desc(auditLogTable.createdAt)).limit(20)),
      // Load the full history (within a generous safety cap) so attempt
      // classification stays correct even when older confirmed attempts fall
      // outside the most recent page.
      safeQuery(
        db.select({ id: emailChangeHistoryTable.id, oldEmail: emailChangeHistoryTable.oldEmail, newEmail: emailChangeHistoryTable.newEmail, changedAt: emailChangeHistoryTable.changedAt })
          .from(emailChangeHistoryTable)
          .where(eq(emailChangeHistoryTable.userId, id))
          .orderBy(desc(emailChangeHistoryTable.changedAt))
          .limit(EMAIL_HISTORY_CLASSIFICATION_CAP)
      ),
      // Load the full attempts list (within a safety cap) for two reasons:
      //   1. Classification accuracy across the whole window (a newer attempt
      //      with the same email can shift which row a history row claims).
      //   2. To know the total so the UI can offer "Show older" paging.
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
          .limit(EMAIL_ATTEMPT_CLASSIFICATION_CAP)
      ),
      safeQuery(
        db.select({ id: phoneChangeHistoryTable.id, oldPhone: phoneChangeHistoryTable.oldPhone, newPhone: phoneChangeHistoryTable.newPhone, changedAt: phoneChangeHistoryTable.changedAt })
          .from(phoneChangeHistoryTable)
          .where(eq(phoneChangeHistoryTable.userId, id))
          .orderBy(desc(phoneChangeHistoryTable.changedAt))
          .limit(50)
      ),
    ]);

    const classified = classifyEmailAttempts(
      emailAttemptRowsFull,
      emailHistoryFull,
      { pendingEmail: member.pendingEmail, emailChangeExpires: member.emailChangeExpires },
    );
    const emailAttempts = classified.slice(0, EMAIL_ATTEMPTS_DEFAULT_PAGE_SIZE);
    const emailHistory = emailHistoryFull.slice(0, EMAIL_HISTORY_RESPONSE_PAGE_SIZE);

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
      emailAttemptsTotal: classified.length,
      emailAttemptsPageSize: EMAIL_ATTEMPTS_DEFAULT_PAGE_SIZE,
      phoneHistory,
    });
  } catch (error) {
    console.error("[Admin] Member detail error:", error);
    res.status(500).json({ error: "Failed to fetch member details" });
  }
});

// Page through a member's email-change attempts. The Member Detail page embeds
// the most recent page via `/full`; this endpoint backs the "Show older" UI
// so support staff can reach attempts that fall outside the first page within
// the audit retention window. Classification is computed across the user's
// full history+attempts (subject to a generous safety cap) so statuses are
// stable across pages.
router.get("/admin/members/:id/email-attempts", requirePermission("members:view"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const rawLimit = req.query.limit;
    const rawOffset = req.query.offset;

    let limit = EMAIL_ATTEMPTS_DEFAULT_PAGE_SIZE;
    if (typeof rawLimit === "string" && rawLimit.length > 0) {
      const parsed = parseInt(rawLimit, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        res.status(400).json({ error: "limit must be a positive integer" });
        return;
      }
      limit = Math.min(parsed, EMAIL_ATTEMPTS_MAX_PAGE_SIZE);
    }

    let offset = 0;
    if (typeof rawOffset === "string" && rawOffset.length > 0) {
      const parsed = parseInt(rawOffset, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        res.status(400).json({ error: "offset must be a non-negative integer" });
        return;
      }
      offset = parsed;
    }

    const [member] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    const [emailHistoryFull, emailAttemptRowsFull] = await Promise.all([
      safeQuery(
        db.select({
          id: emailChangeHistoryTable.id,
          oldEmail: emailChangeHistoryTable.oldEmail,
          newEmail: emailChangeHistoryTable.newEmail,
          changedAt: emailChangeHistoryTable.changedAt,
        })
          .from(emailChangeHistoryTable)
          .where(eq(emailChangeHistoryTable.userId, id))
          .orderBy(desc(emailChangeHistoryTable.changedAt))
          .limit(EMAIL_HISTORY_CLASSIFICATION_CAP),
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
          .limit(EMAIL_ATTEMPT_CLASSIFICATION_CAP),
      ),
    ]);

    const classified = classifyEmailAttempts(
      emailAttemptRowsFull,
      emailHistoryFull,
      { pendingEmail: member.pendingEmail, emailChangeExpires: member.emailChangeExpires },
    );

    const total = classified.length;
    const page = classified.slice(offset, offset + limit);

    res.json({
      attempts: page,
      total,
      offset,
      limit,
      hasMore: offset + page.length < total,
    });
  } catch (error) {
    console.error("[Admin] Member email attempts paging error:", error);
    res.status(500).json({ error: "Failed to fetch email-change attempts" });
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

router.post("/admin/members/:id/cancel-email-change", requirePermission("members:edit"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const [member] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        pendingEmail: usersTable.pendingEmail,
        emailChangeExpires: usersTable.emailChangeExpires,
      })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    if (!member.pendingEmail) {
      res.status(404).json({ error: "No pending email change to cancel" });
      return;
    }

    const previousPendingEmail = member.pendingEmail;
    const previousExpiresAt = member.emailChangeExpires;

    await db
      .update(usersTable)
      .set({ pendingEmail: null, emailChangeToken: null, emailChangeExpires: null })
      .where(eq(usersTable.id, id));

    await logAdminAction(
      req,
      "cancel_email_change",
      "user",
      String(id),
      `Cancelled pending email change for member ${member.email} (was: ${previousPendingEmail})`,
      {
        before: { pendingEmail: previousPendingEmail, emailChangeExpires: previousExpiresAt },
        after: { pendingEmail: null, emailChangeExpires: null },
        // Surfaced as structured fields so the audit-log redactor can
        // strip them from both the description and the diff for viewers
        // without `members:pii`.
        memberEmail: member.email,
        previousPendingEmail,
      },
    );

    // Notify the member at their CURRENT (now-restored) address that the
    // pending change has been discarded by support, naming the dropped
    // address so they understand why a login attempt with it would fail.
    // Fire-and-forget — the cancellation itself has already succeeded and
    // we never want a transient SendGrid/Redis hiccup to surface as an
    // admin-facing 500.
    CommunicationService.queueEmail({
      templateSlug: "email_change_cancelled_by_admin",
      to: member.email,
      variables: {
        member_name: member.name,
        member_email: member.email,
        cancelled_pending_email: previousPendingEmail,
      },
      userId: id,
    }).catch((err) =>
      console.error(
        "[Admin] Failed to enqueue email_change_cancelled_by_admin notice:",
        err,
      ),
    );

    res.json({ success: true, id, pendingEmail: null });
  } catch (error) {
    console.error("[Admin] Cancel email change error:", error);
    res.status(500).json({ error: "Failed to cancel pending email change" });
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
        // Surfaced so the audit-log redactor can scrub the email from the
        // description for viewers without `members:pii`.
        memberEmail: member.email,
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

    await logAdminAction(
      req,
      "impersonate_start",
      "user",
      String(targetId),
      `Admin started impersonating member ${target.name} (${target.email})`,
      {
        // Surfaced as structured fields so the audit-log redactor can
        // scrub the member's name/email from the description for viewers
        // without `members:pii`. The full description is still persisted
        // verbatim so PII-cleared admins can investigate.
        memberName: target.name,
        memberEmail: target.email,
      },
    );

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
    const rateLimitAuditFailures = getRateLimitAuditFailureStats();
    const redisStatus = !redisConnected
      ? "down"
      : queueFallbacks.alerting
        ? "degraded"
        : "up";

    // Treat any rate-limit audit-write failure as a degradation: it means
    // the audit trail security on-callers depend on is silently dropping
    // entries while the 429s themselves keep flowing. Better to flip the
    // top-level status to "degraded" so the banner pops than to leave the
    // System Health page green.
    const overallStatus = !dbOk || queueFallbacks.alerting || !redisConnected || rateLimitAuditFailures.totalCount > 0
      ? "degraded"
      : "healthy";

    res.json({
      status: overallStatus,
      services: {
        api: { status: "up", uptime: process.uptime() },
        database: { status: dbOk ? "up" : "down", totalUsers: userCount, totalTickets: ticketCount },
        redis: { status: redisStatus, queueFallbacks },
        signupChallenge: { enforced: isSignupChallengeEnforced() },
        abuseRateLimitCleanup: getAbuseRateLimitCleanupStatus(),
        rateLimitAuditFailures,
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

/**
 * List recent on-call alert delivery attempts for the System Health page.
 *
 * Mirrors `/admin/system/queue-fallback-events` but filters on the audit rows
 * the queue-fallback alerter writes for *outbound notification* attempts
 * (PagerDuty / ops email / Slack), not the underlying queue-bypass events.
 * Surfacing these next to the queue-fallback timeline lets an on-call admin
 * answer "did the page actually go out?" without leaving System Health and
 * filtering the audit log by hand.
 *
 * Query params:
 *   - limit: number of events to return (default 50, max 200)
 *
 * Filters by `actionType = "queue_fallback_alert"` and
 * `entityType = "alert"` so the list lines up 1:1 with the rows written by
 * `recordDeliveryAttempt` in `queue-fallback-alerter.ts`. The entityType
 * filter is belt-and-braces protection in case a future audit row reuses
 * the action type with a different entityType.
 */
router.get("/admin/system/queue-fallback-alert-events", requirePermission("system:view"), async (req: Request, res: Response) => {
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
      .where(and(
        eq(auditLogTable.actionType, QUEUE_FALLBACK_ALERT_ACTION_TYPE),
        eq(auditLogTable.entityType, QUEUE_FALLBACK_ALERT_ENTITY_TYPE),
      ))
      .orderBy(desc(auditLogTable.createdAt))
      .limit(limit);

    const events = rows.map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const queueChannelRaw = typeof meta.queueChannel === "string" ? meta.queueChannel : row.entityId;
      const queueChannel = queueChannelRaw === "email" || queueChannelRaw === "sms" ? queueChannelRaw : null;
      const deliveryChannelRaw = typeof meta.deliveryChannel === "string" ? meta.deliveryChannel : null;
      const deliveryChannel = deliveryChannelRaw === "pagerduty" || deliveryChannelRaw === "email" || deliveryChannelRaw === "slack"
        ? deliveryChannelRaw
        : null;
      const kindRaw = typeof meta.kind === "string" ? meta.kind : null;
      const kind = kindRaw === "fire" || kindRaw === "clear" ? kindRaw : null;
      const outcomeRaw = typeof meta.outcome === "string" ? meta.outcome : null;
      const outcome = outcomeRaw === "sent" || outcomeRaw === "failed" || outcomeRaw === "throttled" || outcomeRaw === "skipped"
        ? outcomeRaw
        : null;
      const reason = typeof meta.reason === "string" && meta.reason.length > 0 ? meta.reason : null;
      return {
        id: row.id,
        createdAt: row.createdAt,
        queueChannel,
        deliveryChannel,
        kind,
        outcome,
        reason,
        description: row.description,
      };
    });

    res.json({ events, limit });
  } catch (error) {
    console.error("[Admin] Queue fallback alert events error:", error);
    res.status(500).json({ error: "Failed to fetch queue fallback alert events" });
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

    // Production-only: surface every other production-critical secret that
    // is unset/defaulted (JWT_SECRET, SESSION_SECRET, SENDGRID_API_KEY, …).
    // The list is centralized in production-env-guard so adding a new one
    // is a one-line change. Also fan out to on-call — that path is per-
    // secret throttled so this fires at most once per channel per secret
    // per window even though /admin/notifications is polled every minute.
    const missingCriticalSecrets = getMisconfiguredCriticalSecrets();
    for (const secret of missingCriticalSecrets) {
      notifications.push({
        id: secret.id,
        type: "production_env_secret_missing",
        severity: "high",
        title: secret.title,
        message: secret.message,
        link: "/admin/system",
        createdAt: new Date().toISOString(),
      });
    }
    if (missingCriticalSecrets.length > 0) {
      evaluateProductionEnvGuards().catch((err) => {
        console.error("[Admin] production env guard dispatch failed:", err);
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
    // Hide on-call destination rows from the generic settings list — those
    // hold encrypted secrets and have a dedicated UI/endpoint that knows how
    // to decrypt and mask them. Returning the raw row here would dump the
    // ciphertext blob into the generic Settings page.
    const filtered = settings.filter((s) => !isOnCallSettingKey(s.key));
    res.json(filtered);
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

    // The generic settings endpoint records both old and new value in the
    // audit log in plaintext, which is fine for normal operational toggles
    // but would leak PagerDuty / Slack secrets. Force admins to use the
    // dedicated on-call endpoint, which encrypts at rest and never logs the
    // actual value.
    if (isOnCallSettingKey(key)) {
      res.status(400).json({ error: "Use /admin/oncall-destinations to manage on-call destination settings" });
      return;
    }

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

router.get("/admin/oncall-destinations", requirePermission("settings:view"), async (_req: Request, res: Response) => {
  try {
    const status = await getOnCallDestinationsStatus();
    res.json(status);
  } catch (error) {
    console.error("[Admin] Get on-call destinations error:", error);
    res.status(500).json({ error: "Failed to fetch on-call destinations" });
  }
});

router.put("/admin/oncall-destinations", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const { pagerdutyIntegrationKey, opsAlertEmail, opsAlertSlackWebhookUrl } = req.body ?? {};

    interface FieldUpdate {
      field: OnCallField;
      raw: unknown;
    }
    // `null` / "" means "clear the value"; a non-empty string means "save it".
    // Any other type is rejected so the UI can't accidentally write a number
    // or object into one of the secret fields.
    const all: FieldUpdate[] = [
      { field: "pagerdutyIntegrationKey", raw: pagerdutyIntegrationKey },
      { field: "opsAlertEmail", raw: opsAlertEmail },
      { field: "opsAlertSlackWebhookUrl", raw: opsAlertSlackWebhookUrl },
    ];
    const updates: FieldUpdate[] = all.filter((u) => u.raw !== undefined);

    if (updates.length === 0) {
      res.status(400).json({ error: "Provide at least one of pagerdutyIntegrationKey, opsAlertEmail, opsAlertSlackWebhookUrl" });
      return;
    }

    const changed: OnCallField[] = [];
    for (const { field, raw } of updates) {
      let value: string | null;
      if (raw === null || raw === "") {
        value = null;
      } else if (typeof raw === "string") {
        value = raw.trim();
        if (value === "") value = null;
      } else {
        res.status(400).json({ error: `${field} must be a string or null` });
        return;
      }
      if (field === "opsAlertEmail" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        res.status(400).json({ error: "opsAlertEmail must be a valid email address" });
        return;
      }
      await setOnCallDestination(field, value, req.userEmail || (req.userId ? String(req.userId) : null));
      changed.push(field);
    }

    // Audit the change list (without leaking the new secret values) so admins
    // can see who re-targeted on-call destinations and when.
    await logAdminAction(
      req,
      "update_setting",
      "oncall_destinations",
      "oncall",
      `Updated on-call destination(s): ${changed.join(", ")}`,
      { changedFields: changed },
    );

    const status = await getOnCallDestinationsStatus();
    res.json(status);
  } catch (error) {
    console.error("[Admin] Update on-call destinations error:", error);
    res.status(500).json({ error: "Failed to update on-call destinations" });
  }
});

router.post("/admin/oncall-destinations/test", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const results = await sendOnCallTestAlert();
    // Collapse the fire+clear pair per channel into a single per-channel
    // result the UI can render. A channel is "ok" only if both halves of the
    // pair succeeded; "skipped" still propagates as not_configured.
    const byChannel = new Map<string, { channel: string; ok: boolean; skipped: boolean; reason?: string }>();
    for (const r of results) {
      const existing = byChannel.get(r.channel);
      if (!existing) {
        byChannel.set(r.channel, { channel: r.channel, ok: r.ok, skipped: !!r.skipped, reason: r.reason });
        continue;
      }
      // If either half failed, the channel result is failed.
      existing.ok = existing.ok && r.ok;
      // A channel only counts as skipped if both halves were skipped (real
      // sends mark only the fire half as throttled / not_configured for the
      // pagerduty trigger payload).
      existing.skipped = existing.skipped && !!r.skipped;
      if (!r.ok && !existing.reason) existing.reason = r.reason;
      if (r.skipped && !existing.reason) existing.reason = r.reason;
    }
    const summary = Array.from(byChannel.values());
    await logAdminAction(
      req,
      "send_test_alert",
      "oncall_destinations",
      "oncall",
      "Sent on-call test alert (synthetic fire+clear pair)",
      { results: summary },
    );
    res.json({ results: summary });
  } catch (error) {
    console.error("[Admin] Send on-call test alert error:", error);
    res.status(500).json({ error: "Failed to send test alert" });
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
