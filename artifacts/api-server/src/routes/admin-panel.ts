import { Router, type Request, type Response } from "express";
import { db, usersTable, userProductsTable, productsTable, ticketsTable, auditLogTable, systemSettingsTable, adminNotesTable, progressTable, emailChangeHistoryTable, emailChangeAttemptsTable, phoneChangeHistoryTable } from "@workspace/db";
import { eq, ne, and, gt, gte, lt, lte, desc, asc, sql, ilike, or, isNotNull, isNull, getTableColumns, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ADMIN_ROLES, hasPermission, isAdminRole, requirePermission } from "../middleware/rbac";
import { isSignupChallengeEnforced } from "../middleware/captcha";
import { logAdminAction, redactAuditRowPii } from "../lib/audit-log";
import { CommunicationService } from "../lib/communication-service";
import {
  signEmailChangePrefillToken,
  buildEmailChangeRestartUrl,
} from "../lib/email-change-prefill-token";
import { isRedisConnected } from "../lib/redis";
import { getQueueFallbackStatsFromDb } from "../lib/queue-fallback-tracker";
import { getAbuseRateLimitCleanupStatus } from "../lib/abuse-rate-limit-cleanup";
import {
  getEmailChangeAttemptsCleanupStatus,
  getEmailChangeAttemptsRetentionPolicy,
} from "../lib/email-change-attempts-cleanup";
import {
  getRateLimitAuditFailureStats,
  getRateLimitAuditFailureStatsAggregated,
} from "../lib/rate-limit-audit-failure-tracker";
import { getQueueFallbackAuditCleanupStatus } from "../lib/queue-fallback-audit-cleanup";
import { getAuthRateLimitAuditCleanupStatus } from "../lib/auth-rate-limit-audit-cleanup";
import { getAuditLogRetentionStatus } from "../lib/audit-log-retention";
import {
  evaluateRateLimitAuditFailureAlert,
  getRateLimitAuditFailureAlertingState,
} from "../lib/rate-limit-audit-failure-alerter";
import { evaluateSignupChallengeAlert } from "../lib/signup-challenge-alerter";
import { evaluateAuthRateLimitAlert } from "../lib/auth-rate-limit-alerter";
import {
  evaluateProductionEnvGuards,
  getMisconfiguredCriticalSecrets,
  getSecretMisconfigurationState,
} from "../lib/production-env-guard";
import { AUTH_RATE_LIMIT_AUDIT_ACTION } from "./auth";
import {
  getOnCallDestinations,
  getOnCallDestinationsStatus,
  setOnCallDestination,
  isOnCallSettingKey,
  type OnCallField,
} from "../lib/oncall-settings";
import {
  getAuthRateLimitAlertConfigStatus,
  applyAuthRateLimitAlertConfigUpdate,
  validateUpdate as validateAuthRateLimitAlertUpdate,
  isAuthRateLimitAlertSettingKey,
} from "../lib/auth-rate-limit-alert-settings";
import {
  getChangeHistoryRetentionConfigStatus,
  applyChangeHistoryRetentionConfigUpdate,
  validateUpdate as validateChangeHistoryRetentionUpdate,
  isChangeHistoryRetentionSettingKey,
} from "../lib/change-history-retention-settings";
import {
  sendOnCallTestAlert,
  probePagerDutyDestination,
  probeEmailDestination,
  probeSlackDestination,
  QUEUE_FALLBACK_ALERT_ACTION_TYPE,
  QUEUE_FALLBACK_ALERT_ENTITY_TYPE,
  type ProbeResult,
} from "../lib/queue-fallback-alerter";
import {
  getActiveThrottleSlots,
  getAlertingFlags,
} from "../lib/queue-fallback-alerter-state";
import jwt from "jsonwebtoken";

const router = Router();

// The burst-stats query, threshold logic, and on-call dispatch all live in
// `auth-rate-limit-alerter` — the route just calls into it and renders the
// returned `stats`. The alerter pulls its threshold (default 10), window
// (default 15 min), and dominant-IP ratio (default 0.6) from
// `auth-rate-limit-alert-settings`, which stores them in `system_settings`
// so admins can tune them from the admin Settings page without restarting.
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

// RFC 4180-style escaping for a single CSV field. The implementation lives
// in the shared `lib/csv` module so the audit-log, members, and comms-log
// streaming exports apply identical escaping rules; we re-export it here so
// any older callers that pulled it from this route module keep working.
import { csvEscape } from "../lib/csv";
export { csvEscape };

// Page sizes for the admin Member Detail "Email change attempts" card. The
// initial render embeds the most recent page in `/admin/members/:id/full`;
// older attempts are paged in via `/admin/members/:id/email-attempts` so
// support staff can reach attempts that fall outside the first page. Ordinary
// audit rows are kept for ~90 days, but admin-cancelled rows are kept for
// ~1 year (see `email-change-attempts-cleanup`) so support can still see who
// cancelled what when working stale tickets.
const EMAIL_ATTEMPTS_DEFAULT_PAGE_SIZE = 50;
const EMAIL_ATTEMPTS_MAX_PAGE_SIZE = 100;
// Safety cap on in-memory classification: with retention windows of 90 days
// (audit) / 365 days (admin-cancelled) and per-member email-change rate
// limits, real members never approach this many rows. The cap exists purely
// to keep a misconfigured account from OOMing the admin endpoint.
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
  // Populated when an admin cancelled this still-pending attempt via the
  // member-detail page. The join on `users` is left-joined so the admin
  // name/email may be null if the admin user has since been deleted.
  cancelledAt?: Date | null;
  cancelledByAdminId?: number | null;
  cancelledByAdminName?: string | null;
  cancelledByAdminEmail?: string | null;
  // Populated when the member cancelled their own pending change via
  // POST /members/me/email/cancel, or replaced it with a new attempt via
  // POST /members/me/email. Stamped together with `cancelledAt`. Lets the
  // classifier distinguish member-initiated cancels from admin-initiated
  // ones (which set `cancelledByAdminId` instead).
  cancelledByMember?: boolean | null;
  // Populated when the member dismissed the in-app banner that surfaced
  // an admin-cancelled attempt. Surfaced on the admin Member Detail page
  // so support staff can confirm whether the member ever acknowledged
  // the cancellation in the portal.
  dismissedByMemberAt?: Date | null;
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
  cancelledAt: string | null;
  cancelledByAdminId: number | null;
  cancelledByAdminName: string | null;
  cancelledByAdminEmail: string | null;
  // True when the member cancelled or replaced their own pending change.
  // Surfaced separately from `cancelledByAdminId` so the UI can render
  // "Cancelled by member" without having to infer it from the absence of
  // an admin id (which could also mean the admin user was deleted).
  cancelledByMember: boolean;
  // ISO timestamp of when the member dismissed the in-app banner that
  // surfaced an admin-cancelled attempt, or null if they have not yet
  // dismissed it. Only meaningful for `cancelled_by_admin` rows; on other
  // statuses the column is unused and serialized as null.
  dismissedByMemberAt: string | null;
  status:
    | "pending"
    | "confirmed"
    | "expired"
    | "abandoned"
    | "cancelled_by_admin"
    | "cancelled_by_member";
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
    let status:
      | "pending"
      | "confirmed"
      | "expired"
      | "abandoned"
      | "cancelled_by_admin"
      | "cancelled_by_member";
    if (confirmedAt) {
      // Confirmation always wins, even on rows we also marked cancelled —
      // in practice an attempt can't be both, but if a race ever produces
      // such a row the user-visible truth is "this email actually changed".
      status = "confirmed";
    } else if (a.cancelledAt) {
      // Explicit cancellations take precedence over the expired/abandoned
      // bucket so support staff can tell why the attempt died. Admin
      // cancellations win over member cancellations when both flags are
      // somehow set on the same row (shouldn't happen in practice — the
      // member-cancel path skips already-cancelled rows — but the admin
      // action is the more notable support-relevant signal). Rows with a
      // `cancelledAt` but neither flag set fall back to admin-cancelled
      // for backward compatibility with legacy rows pre-dating the
      // member-cancel marker.
      if (a.cancelledByMember && a.cancelledByAdminId == null) {
        status = "cancelled_by_member";
      } else {
        status = "cancelled_by_admin";
      }
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
      cancelledAt: a.cancelledAt ? a.cancelledAt.toISOString() : null,
      cancelledByAdminId: a.cancelledByAdminId ?? null,
      cancelledByAdminName: a.cancelledByAdminName ?? null,
      cancelledByAdminEmail: a.cancelledByAdminEmail ?? null,
      cancelledByMember: a.cancelledByMember === true,
      dismissedByMemberAt: a.dismissedByMemberAt
        ? a.dismissedByMemberAt.toISOString()
        : null,
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

    // Detect a burst of auth rate-limit hits in the configured window.
    // The alerter owns the burst-stats query, the threshold check, AND
    // the on-call dispatch on any not-alerting → alerting transition, so
    // the dashboard surfaces the burst inline AND on-call gets paged
    // out-of-hours from the same call. Threshold / window / dominant-IP
    // ratio are read from `auth-rate-limit-alert-settings` inside the
    // alerter (cached for ~10s) so admin edits in the Settings UI take
    // effect immediately. Errors are swallowed inside the alerter and the
    // outer `.catch` so a transient DB error degrades to "no alert"
    // instead of breaking the whole panel.
    const rateLimitEval = await evaluateAuthRateLimitAlert(now.getTime()).catch(
      (err) => {
        console.error("[Admin] Auth rate-limit alerter error:", err);
        return null;
      },
    );
    if (rateLimitEval && rateLimitEval.stats.alerting) {
      const stats = rateLimitEval.stats;
      const rateLimitWindowMinutes = Math.round(stats.windowMs / 60000);
      const ipSuffix =
        stats.dominantIp && stats.dominantShare >= stats.dominantIpRatio
          ? ` — ${stats.dominantCount} from ${stats.dominantIp}`
          : "";
      alerts.push({
        type: "auth_rate_limit_burst",
        severity: "high",
        title: "Auth rate-limit burst",
        description: `${stats.total} auth rate-limit hits in the last ${rateLimitWindowMinutes} minutes${ipSuffix}`,
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
// server. `t` is the anchor's createdAt as a microsecond-precision UTC ISO
// string (e.g. "2026-01-01T00:00:00.123456Z") and `i` is its numeric id;
// together they form the (created_at, id) tuple that the
// (audit_log_created_at_id_idx) composite index walks.
//
// We deliberately keep the timestamp as a string rather than a JS number:
// `Date.getTime()` returns ms-since-epoch and silently drops Postgres'
// microsecond component on the round-trip. When two rows share the same
// sub-millisecond `created_at`, a ms-only cursor's equality predicate
// (`created_at = $cursor`) fails to match the rows on the boundary timestamp
// and they vanish from the paginated view. Binding the anchor as a
// microsecond-precision string and casting to `timestamptz` in SQL preserves
// the original precision and keeps the keyset compare correct.

type AuditCursor = { t: string; i: number };

// Allow-list of `metadata.outcome` values accepted by the audit-log filter.
// Mirrors the `AlertDeliveryOutcome` union in queue-fallback-alerter.ts —
// arbitrary strings are rejected so a malformed `?outcome=` doesn't issue
// a fruitless JSONB path scan or surface "no such outcome" rows.
const ALERT_OUTCOME_FILTER_VALUES = new Set(["sent", "failed", "throttled", "skipped"]);

// Microsecond-precision ISO of a row's createdAt. Selected as an alias so
// the value never round-trips through JS's millisecond-only Date type and
// therefore preserves the column's full timestamptz precision.
const auditCursorTsExpr = sql<string>`to_char(${auditLogTable.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// SELECT shape used everywhere a returned row may become a cursor anchor.
// We pull every audit_log column (so callers still get a complete row) plus
// the cursor-timestamp alias. The alias is stripped before the response is
// serialized so it doesn't leak into the public payload.
const auditSelectWithCursor = () => ({
  ...getTableColumns(auditLogTable),
  cursorTs: auditCursorTsExpr,
});

type AuditRowWithCursor = typeof auditLogTable.$inferSelect & { cursorTs: string };

function stripCursorTs<T extends { cursorTs?: unknown }>(row: T): Omit<T, "cursorTs"> {
  const { cursorTs: _omit, ...rest } = row;
  return rest;
}

// Convert a JS Date to a microsecond-precision ISO string suitable for use
// as a cursor anchor or `::timestamptz` bind. The Date itself only has ms
// precision so the trailing microsecond digits are zero — that's fine for
// inputs that originated from the user (e.g. /admin/audit-log?jumpTo=...).
function dateToMicrosecondIso(d: Date): string {
  // toISOString() yields "...sss.SSSZ"; pad to six fractional digits.
  return d.toISOString().replace(/Z$/, "000Z");
}

function encodeAuditCursor(c: AuditCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeAuditCursor(raw: unknown): AuditCursor | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!json || typeof json !== "object") return null;
    const i = Number((json as Record<string, unknown>).i);
    if (!Number.isInteger(i) || i <= 0) return null;
    const rawT = (json as Record<string, unknown>).t;
    // Accept legacy (number / ms-since-epoch) cursors so in-flight requests
    // from open browser tabs continue to work after the format change. The
    // legacy form loses sub-millisecond precision, but a stale cursor only
    // shows up for the brief window between deploy and the next page click.
    if (typeof rawT === "string" && rawT.length > 0) {
      return { t: rawT, i };
    }
    if (typeof rawT === "number" && Number.isFinite(rawT)) {
      return { t: dateToMicrosecondIso(new Date(rawT)), i };
    }
    return null;
  } catch {
    return null;
  }
}

// Build a row-tuple comparison predicate. We can't rely on the SQL row
// constructor (`(created_at, id) < (?, ?)`) compiling cleanly through every
// driver path, so we expand the lexicographic compare by hand:
//   strict_left  OR  (equal AND strict_inner)
// where `equal` is (created_at = anchor.t) and `strict_inner` is the id
// compare. The anchor timestamp is bound as a string and cast to
// `timestamptz` so Postgres compares with full microsecond precision; this
// still uses the (created_at, id) btree because the planner recognizes the
// equality + inequality split.
function olderThanCursor(c: AuditCursor): SQL {
  return sql`(${auditLogTable.createdAt} < ${c.t}::timestamptz OR (${auditLogTable.createdAt} = ${c.t}::timestamptz AND ${auditLogTable.id} < ${c.i}))`;
}

function newerThanCursor(c: AuditCursor): SQL {
  return sql`(${auditLogTable.createdAt} > ${c.t}::timestamptz OR (${auditLogTable.createdAt} = ${c.t}::timestamptz AND ${auditLogTable.id} > ${c.i}))`;
}

function olderOrEqualToCursor(c: AuditCursor): SQL {
  return sql`(${auditLogTable.createdAt} < ${c.t}::timestamptz OR (${auditLogTable.createdAt} = ${c.t}::timestamptz AND ${auditLogTable.id} <= ${c.i}))`;
}

function rowToCursor(row: { cursorTs?: string | null; id: number }): AuditCursor | null {
  if (!row.cursorTs) return null;
  return { t: row.cursorTs, i: row.id };
}

// Bounded "N matching rows" count for the admin Audit Log read endpoint.
// The export-truncation warning and the "N matching rows" display both
// depend on this value, but a full filtered `count(*)` against a multi-
// million-row audit_log is the dominant cost of the page load. Instead we
// aggregate inside a `LIMIT cap+1` subquery so Postgres stops reading
// after at most `cap + 1` matching rows — bounded work even when the true
// total is in the millions. When the true total exceeds the cap we report
// `capped: true` so the UI can render "More than N matching rows" and the
// truncation warning still fires. The cap is always the export hard cap
// (so `total > exportCap` and `capped` carry the same information about
// whether an export will be truncated).
async function safeCappedAuditCount(
  whereClause: SQL | undefined,
  cap: number,
): Promise<{ count: number; capped: boolean }> {
  try {
    const whereSql = whereClause ? sql`WHERE ${whereClause}` : sql``;
    const result = await db.execute(sql`
      SELECT count(*)::int AS count FROM (
        SELECT 1 FROM ${auditLogTable}
        ${whereSql}
        LIMIT ${cap + 1}
      ) sub
    `);
    const rows = (result as unknown as { rows?: Array<{ count: number | string }> }).rows ?? [];
    const raw = Number(rows[0]?.count ?? 0);
    if (raw > cap) return { count: cap, capped: true };
    return { count: raw, capped: false };
  } catch {
    return { count: 0, capped: false };
  }
}

router.get("/admin/audit-log", requirePermission("audit:view"), async (req: Request, res: Response) => {
  try {
    const { actionType, entityType, actorId, startDate, endDate, outcome, page, limit = "50", expand, cursor, direction, jumpTo } = req.query;

    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));

    const conditions: any[] = [];
    if (actionType && typeof actionType === "string") conditions.push(eq(auditLogTable.actionType, actionType));
    if (entityType && typeof entityType === "string") conditions.push(eq(auditLogTable.entityType, entityType));
    if (actorId && typeof actorId === "string") conditions.push(eq(auditLogTable.actorId, parseInt(actorId, 10)));
    if (startDate && typeof startDate === "string") conditions.push(gte(auditLogTable.createdAt, new Date(startDate)));
    if (endDate && typeof endDate === "string") conditions.push(lte(auditLogTable.createdAt, new Date(endDate)));
    // Alert outcome filter — only meaningful for queue_fallback_alert rows,
    // whose `metadata.outcome` is one of sent/failed/throttled/skipped (see
    // queue-fallback-alerter.ts AlertDeliveryOutcome). Allow-list the value
    // so an arbitrary client-supplied string can't smuggle into the JSONB
    // path expression even though it's parameterized.
    if (outcome && typeof outcome === "string" && ALERT_OUTCOME_FILTER_VALUES.has(outcome)) {
      conditions.push(sql`${auditLogTable.metadata}->>'outcome' = ${outcome}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const canSeePii = hasPermission(req.adminRole, "members:pii");
    // Strip the cursor-timestamp alias from every row before serializing,
    // and apply PII redaction in the same pass for non-privileged viewers.
    const sanitize = (rows: AuditRowWithCursor[]) => {
      const stripped = rows.map(stripCursorTs);
      return canSeePii ? stripped : stripped.map(redactAuditRowPii);
    };

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
        .select({ id: auditLogTable.id, createdAt: auditLogTable.createdAt, cursorTs: auditCursorTsExpr })
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
          const targetCursor: AuditCursor = { t: target.cursorTs, i: target.id };
          const half = Math.floor(limitNum / 2);

          // Newer half: rows strictly newer than the target. Fetch one extra
          // to detect whether more newer rows exist (drives the prevCursor).
          const newerWhere = whereClause
            ? and(whereClause, newerThanCursor(targetCursor))
            : newerThanCursor(targetCursor);
          const newerLookup = half > 0
            ? await db.select(auditSelectWithCursor()).from(auditLogTable).where(newerWhere)
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
          const olderLookup = await db.select(auditSelectWithCursor()).from(auditLogTable).where(olderWhere)
            .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
            .limit(remaining + 1);
          const hasMoreOlder = olderLookup.length > remaining;
          const olderRows = hasMoreOlder ? olderLookup.slice(0, remaining) : olderLookup;

          const logs = [...newerRows, ...olderRows];
          const first = logs[0];
          const last = logs[logs.length - 1];

          // Bounded count (LIMIT cap+1 inside a subquery) so the UI can
          // show "N matching" alongside the export buttons without paying
          // for a full filtered count(*) on a multi-million-row audit log.
          // Runs once per filter change (the deep-link path is a first
          // fetch); follow-up cursor pagination skips it. When the true
          // total exceeds the cap, `totalIsApproximate` flips to true and
          // the UI renders "More than N matching rows".
          const exportCap = resolveAuditLogExportHardCap();
          const cappedTotal = await safeCappedAuditCount(whereClause, exportCap);

          res.json({
            logs: sanitize(logs),
            pagination: {
              page: null,
              limit: limitNum,
              total: cappedTotal.count,
              totalPages: null,
              totalIsApproximate: cappedTotal.capped,
            },
            exportCap,
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
      const anchor: AuditCursor = { t: dateToMicrosecondIso(jumpToDate), i: 2_147_483_647 };
      const olderWhere = whereClause
        ? and(whereClause, olderOrEqualToCursor(anchor))
        : olderOrEqualToCursor(anchor);
      const olderLookup = await db.select(auditSelectWithCursor()).from(auditLogTable).where(olderWhere)
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

      // Bounded count (LIMIT cap+1) so the UI can show "N matching"
      // alongside exports — matches the behaviour of the first-page and
      // expand= branches. See `safeCappedAuditCount` for why we don't
      // issue a full count(*) here.
      const exportCap = resolveAuditLogExportHardCap();
      const cappedTotal = await safeCappedAuditCount(whereClause, exportCap);

      res.json({
        logs: sanitize(window),
        pagination: {
          page: null,
          limit: limitNum,
          total: cappedTotal.count,
          totalPages: null,
          totalIsApproximate: cappedTotal.capped,
        },
        exportCap,
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
        const rows = await db.select(auditSelectWithCursor()).from(auditLogTable).where(where)
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
      const rows = await db.select(auditSelectWithCursor()).from(auditLogTable).where(where)
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
        db.select(auditSelectWithCursor()).from(auditLogTable).where(whereClause)
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
    // We also run a bounded "N matching" count for the active filters so
    // the UI can surface the row count and export-truncation warning. The
    // count is capped via a `LIMIT cap+1` subquery so it stays cheap on
    // multi-million-row audit logs (see `safeCappedAuditCount`); when the
    // cap fires the response carries `totalIsApproximate: true`. This
    // only runs on filter changes — the cursor branches above stay
    // count-free.
    const exportCap = resolveAuditLogExportHardCap();
    const [rows, cappedTotal] = await Promise.all([
      db.select(auditSelectWithCursor()).from(auditLogTable).where(whereClause)
        .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
        .limit(limitNum + 1),
      safeCappedAuditCount(whereClause, exportCap),
    ]);
    const hasMoreOlder = rows.length > limitNum;
    const window = hasMoreOlder ? rows.slice(0, limitNum) : rows;
    const last = window[window.length - 1];
    res.json({
      logs: sanitize(window),
      pagination: {
        page: null,
        limit: limitNum,
        total: cappedTotal.count,
        totalPages: null,
        totalIsApproximate: cappedTotal.capped,
      },
      exportCap,
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
  const { actionType, entityType, startDate, endDate, outcome, format = "csv" } = req.query;
  const conditions: any[] = [];
  if (actionType && typeof actionType === "string") conditions.push(eq(auditLogTable.actionType, actionType));
  if (entityType && typeof entityType === "string") conditions.push(eq(auditLogTable.entityType, entityType));
  if (startDate && typeof startDate === "string") conditions.push(gte(auditLogTable.createdAt, new Date(startDate)));
  if (endDate && typeof endDate === "string") conditions.push(lte(auditLogTable.createdAt, new Date(endDate)));
  // Match the read endpoint's outcome filter so the export is consistent
  // with the row count the UI displays.
  if (outcome && typeof outcome === "string" && ALERT_OUTCOME_FILTER_VALUES.has(outcome)) {
    conditions.push(sql`${auditLogTable.metadata}->>'outcome' = ${outcome}`);
  }
  const baseWhere = conditions.length > 0 ? and(...conditions) : undefined;
  const hardCap = resolveAuditLogExportHardCap();

  // Hoisted out of the try block so the catch handler can tell a
  // user-initiated cancel (client closed the socket; downstream
  // res.write / DB calls then throw) apart from a genuine 500.
  let aborted = false;
  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });

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

    // Browsers' fetch() does not surface HTTP trailers reliably, so we
    // also publish the export's hard cap as a *regular* up-front response
    // header. The client can then derive truncation by comparing the
    // number of rows it actually streamed to this cap (when the streamed
    // count equals the cap and the read endpoint's matching count is
    // higher, the export was cut short). This costs us no extra DB work
    // — the cap is a config value — and lets the post-export toast warn
    // admins about a truncated download even when trailers are dropped.
    res.setHeader("X-Audit-Log-Hard-Cap", String(hardCap));

    const auditExposed = [
      "Content-Disposition",
      "Trailer",
      "X-Audit-Log-Hard-Cap",
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
    let written = 0;
    let truncated = false;

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

      // The batch query is `await`ed above, so the client may have
      // disconnected (and `aborted` flipped) while we were waiting for
      // Postgres. Bail before writing rows to a closed socket so we don't
      // emit ERR_STREAM_WRITE_AFTER_END or trip the catch block on a
      // user-initiated cancellation.
      if (aborted) break;

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

    // When the client disconnects mid-stream, the response is already in
    // a closed/destroyed state — writing the JSON terminator, declared
    // trailers, or calling res.end() would either no-op or emit an
    // ERR_STREAM_WRITE_AFTER_END that surfaces as a 500-flavoured log
    // line. Skip the entire wrap-up and let the closed socket be the
    // signal to the client.
    if (aborted) return;

    if (isJson) res.write("]");
    const trailers: Record<string, string> = {
      "X-Audit-Log-Returned-Count": String(written),
    };
    if (truncated) trailers["X-Audit-Log-Truncated"] = "true";
    res.addTrailers(trailers);
    res.end();
  } catch (error) {
    // A user-initiated cancel surfaces here when an in-flight `res.write`
    // / DB query happens to throw against the closed socket. Treat it as
    // a normal cancellation rather than a 500 — the client already knows
    // it tore the connection down.
    if (aborted) {
      return;
    }
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
      safeQuery((async () => {
        // Aliased self-join so we can render "cancelled by <admin name>" on
        // the member detail page without a second round-trip per row.
        const cancelledByAdmin = alias(usersTable, "cancelled_by_admin");
        return db.select({
          id: emailChangeAttemptsTable.id,
          newEmail: emailChangeAttemptsTable.newEmail,
          createdAt: emailChangeAttemptsTable.createdAt,
          expiresAt: emailChangeAttemptsTable.expiresAt,
          cancelledAt: emailChangeAttemptsTable.cancelledAt,
          cancelledByAdminId: emailChangeAttemptsTable.cancelledByAdminId,
          cancelledByAdminName: cancelledByAdmin.name,
          cancelledByAdminEmail: cancelledByAdmin.email,
          cancelledByMember: emailChangeAttemptsTable.cancelledByMember,
          dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
        })
          .from(emailChangeAttemptsTable)
          .leftJoin(
            cancelledByAdmin,
            eq(cancelledByAdmin.id, emailChangeAttemptsTable.cancelledByAdminId),
          )
          .where(and(
            eq(emailChangeAttemptsTable.userId, id),
            isNotNull(emailChangeAttemptsTable.newEmail),
          ))
          .orderBy(desc(emailChangeAttemptsTable.createdAt))
          .limit(EMAIL_ATTEMPT_CLASSIFICATION_CAP);
      })()),
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

// Recent audit-log rows for a single ticket. Backs the "Recent activity" card
// on the admin Ticket Detail page — each row is rendered there as a deep-link
// to `/admin/audit-log?entityType=ticket&expand=<id>` so admins can jump
// straight to the full audit row (status changes, assignments, merges, …).
// Capped to a small recent window; the audit log page is the source of truth
// for the full history.
const TICKET_AUDIT_HISTORY_LIMIT = 20;
router.get("/admin/tickets/:id/audit-history", requirePermission("tickets:view"), async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const id = typeof rawId === "string" ? parseInt(rawId, 10) : NaN;
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ticket ID" }); return; }

    const auditHistory = await safeQuery(
      db.select()
        .from(auditLogTable)
        .where(and(eq(auditLogTable.entityType, "ticket"), eq(auditLogTable.entityId, String(id))))
        .orderBy(desc(auditLogTable.createdAt))
        .limit(TICKET_AUDIT_HISTORY_LIMIT)
    );

    // Mirror the audit-log endpoint's redaction policy so non-PII viewers
    // don't see member emails / IPs leak through the embedded card.
    const canSeePii = hasPermission(req.adminRole, "members:pii");
    const auditRows = canSeePii ? auditHistory : auditHistory.map(redactAuditRowPii);

    res.json({ auditHistory: auditRows, limit: TICKET_AUDIT_HISTORY_LIMIT });
  } catch (error) {
    console.error("[Admin] Ticket audit history error:", error);
    res.status(500).json({ error: "Failed to fetch ticket audit history" });
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
    const rawStatus = req.query.status;

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

    // Optional status filter — when set, the returned `total` reflects the
    // filtered count so the "Show older" pager can keep paging through
    // matching rows past the first page (the whole point of this filter
    // for support staff is "show me only the admin-cancelled ones").
    const ALLOWED_STATUSES = new Set([
      "pending",
      "confirmed",
      "expired",
      "abandoned",
      "cancelled_by_admin",
      "cancelled_by_member",
    ]);
    let statusFilter: string | null = null;
    if (typeof rawStatus === "string" && rawStatus.length > 0) {
      if (!ALLOWED_STATUSES.has(rawStatus)) {
        res.status(400).json({ error: "status must be one of pending, confirmed, expired, abandoned, cancelled_by_admin, cancelled_by_member" });
        return;
      }
      statusFilter = rawStatus;
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
      safeQuery((async () => {
        // Aliased self-join so we can render "cancelled by <admin name>" on
        // the member detail page without a second round-trip per row.
        const cancelledByAdmin = alias(usersTable, "cancelled_by_admin");
        return db.select({
          id: emailChangeAttemptsTable.id,
          newEmail: emailChangeAttemptsTable.newEmail,
          createdAt: emailChangeAttemptsTable.createdAt,
          expiresAt: emailChangeAttemptsTable.expiresAt,
          cancelledAt: emailChangeAttemptsTable.cancelledAt,
          cancelledByAdminId: emailChangeAttemptsTable.cancelledByAdminId,
          cancelledByAdminName: cancelledByAdmin.name,
          cancelledByAdminEmail: cancelledByAdmin.email,
          cancelledByMember: emailChangeAttemptsTable.cancelledByMember,
          dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
        })
          .from(emailChangeAttemptsTable)
          .leftJoin(
            cancelledByAdmin,
            eq(cancelledByAdmin.id, emailChangeAttemptsTable.cancelledByAdminId),
          )
          .where(and(
            eq(emailChangeAttemptsTable.userId, id),
            isNotNull(emailChangeAttemptsTable.newEmail),
          ))
          .orderBy(desc(emailChangeAttemptsTable.createdAt))
          .limit(EMAIL_ATTEMPT_CLASSIFICATION_CAP);
      })()),
    ]);

    const classified = classifyEmailAttempts(
      emailAttemptRowsFull,
      emailHistoryFull,
      { pendingEmail: member.pendingEmail, emailChangeExpires: member.emailChangeExpires },
    );

    const filtered = statusFilter
      ? classified.filter((c) => c.status === statusFilter)
      : classified;
    const total = filtered.length;
    const page = filtered.slice(offset, offset + limit);

    res.json({
      attempts: page,
      total,
      offset,
      limit,
      hasMore: offset + page.length < total,
      status: statusFilter,
    });
  } catch (error) {
    console.error("[Admin] Member email attempts paging error:", error);
    res.status(500).json({ error: "Failed to fetch email-change attempts" });
  }
});

// Per-attempt detail panel for the admin Member Detail page. The list view
// only shows status + requested-at + would-have-expired-at; this endpoint
// answers the "what happened next?" question support staff have when
// looking at an old abandoned/expired attempt — i.e. did the member
// eventually confirm a different email, or follow up with another attempt?
//
// Returns:
//   - `attempt`: the same classified shape `/email-attempts` returns
//   - `auditEntries`: audit_log rows tied to this user (entity_type=user,
//     entity_id=:id) within the attempt's lifetime window. Today the
//     primary writer for this entity is `cancel_email_change`; other
//     admin actions on the same user that fall inside the window are
//     surfaced too so support has full context. PII-redacted for viewers
//     without `members:pii`.
//   - `nextAttempt`: the next classified attempt by the same member after
//     this one's createdAt (or null if this is the latest)
//   - `subsequentConfirmation`: the next email_change_history row by this
//     member with changedAt >= attempt.createdAt (or null if none). For a
//     confirmed attempt this *is* its own confirmation row; for an
//     abandoned/expired attempt this is the eventual change that
//     superseded it (if any), which is exactly what the task is asking for.
router.get("/admin/members/:id/email-attempts/:attemptId", requirePermission("members:view"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }
    const attemptId = parseInt(req.params.attemptId, 10);
    if (isNaN(attemptId)) { res.status(400).json({ error: "Invalid attempt ID" }); return; }

    const [member] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    // Confirm the attempt belongs to this user before doing more work, so
    // we don't leak attempt rows from a different user via a swapped id.
    const [targetAttemptRow] = await db
      .select({
        id: emailChangeAttemptsTable.id,
        userId: emailChangeAttemptsTable.userId,
        createdAt: emailChangeAttemptsTable.createdAt,
      })
      .from(emailChangeAttemptsTable)
      .where(
        and(
          eq(emailChangeAttemptsTable.id, attemptId),
          eq(emailChangeAttemptsTable.userId, id),
        ),
      )
      .limit(1);
    if (!targetAttemptRow) {
      res.status(404).json({ error: "Email-change attempt not found" });
      return;
    }

    const cancelledByAdmin = alias(usersTable, "cancelled_by_admin");
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
          cancelledAt: emailChangeAttemptsTable.cancelledAt,
          cancelledByAdminId: emailChangeAttemptsTable.cancelledByAdminId,
          cancelledByAdminName: cancelledByAdmin.name,
          cancelledByAdminEmail: cancelledByAdmin.email,
          cancelledByMember: emailChangeAttemptsTable.cancelledByMember,
          dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
        })
          .from(emailChangeAttemptsTable)
          .leftJoin(
            cancelledByAdmin,
            eq(cancelledByAdmin.id, emailChangeAttemptsTable.cancelledByAdminId),
          )
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

    const attempt = classified.find((c) => c.id === attemptId) ?? null;
    if (!attempt) {
      // Either the attempt was a legacy row with no newEmail (filtered out
      // upstream) or it fell off the classification cap. Both are unusual
      // for the click-through path.
      res.status(404).json({ error: "Email-change attempt not found" });
      return;
    }

    // The classifier preserves DESC order, so to find "the attempt
    // immediately after this one" we walk the list in reverse and pick
    // the one with the smallest createdAt strictly greater than ours.
    const attemptCreatedAt = new Date(attempt.requestedAt);
    let nextAttempt: ClassifiedEmailAttempt | null = null;
    for (let i = classified.length - 1; i >= 0; i--) {
      const candidate = classified[i];
      if (candidate.id === attempt.id) continue;
      const candidateAt = new Date(candidate.requestedAt);
      if (candidateAt.getTime() > attemptCreatedAt.getTime()) {
        nextAttempt = candidate;
        break;
      }
    }

    // Subsequent confirmation: the oldest email_change_history row whose
    // changedAt is at or after this attempt's createdAt. For a confirmed
    // attempt this returns the matching history row; for an abandoned
    // one this returns the next change the member ever made (which is
    // exactly the resolution support is hunting for).
    const historyAsc = [...emailHistoryFull].sort(
      (a, b) => a.changedAt.getTime() - b.changedAt.getTime(),
    );
    const subsequentConfirmationRow = historyAsc.find(
      (h) => h.changedAt.getTime() >= attemptCreatedAt.getTime(),
    ) ?? null;

    // Audit-log window: from the attempt's createdAt up to the next
    // attempt's createdAt (or now if this is the latest). Cap at a small
    // number of rows since this is a click-through detail panel — the
    // full audit log is reachable from the Audit tab if more is needed.
    const auditWindowEnd = nextAttempt
      ? new Date(nextAttempt.requestedAt)
      : new Date();
    const canSeePii = hasPermission(req.adminRole, "members:pii");
    const auditRowsRaw = await safeQuery(
      db
        .select()
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.entityType, "user"),
            eq(auditLogTable.entityId, String(id)),
            gte(auditLogTable.createdAt, attemptCreatedAt),
            lte(auditLogTable.createdAt, auditWindowEnd),
          ),
        )
        .orderBy(asc(auditLogTable.createdAt))
        .limit(20),
    );
    const auditEntries = canSeePii
      ? auditRowsRaw
      : auditRowsRaw.map(redactAuditRowPii);

    res.json({
      attempt,
      auditEntries,
      nextAttempt,
      subsequentConfirmation: subsequentConfirmationRow
        ? {
            id: subsequentConfirmationRow.id,
            oldEmail: subsequentConfirmationRow.oldEmail,
            newEmail: subsequentConfirmationRow.newEmail,
            changedAt: subsequentConfirmationRow.changedAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    console.error("[Admin] Member email attempt detail error:", error);
    res.status(500).json({ error: "Failed to fetch email-change attempt detail" });
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
    const cancelledAt = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({ pendingEmail: null, emailChangeToken: null, emailChangeExpires: null })
        .where(eq(usersTable.id, id));

      // Mark the matching still-pending attempt row(s) as cancelled-by-admin
      // so the Email change attempts card on the member detail page can
      // surface this as a distinct status (vs. expired / abandoned). The
      // attempt is identified by the same (newEmail, expiresAt) pair the
      // member's user record had — those values were copied straight from
      // the attempt row when /members/me/email created it. We only touch
      // rows that aren't already cancelled so re-running the cancel doesn't
      // overwrite the original admin/timestamp.
      const matchClauses = [
        eq(emailChangeAttemptsTable.userId, id),
        isNull(emailChangeAttemptsTable.cancelledAt),
        sql`lower(${emailChangeAttemptsTable.newEmail}) = lower(${previousPendingEmail})`,
      ];
      if (previousExpiresAt) {
        matchClauses.push(eq(emailChangeAttemptsTable.expiresAt, previousExpiresAt));
      }
      await tx
        .update(emailChangeAttemptsTable)
        .set({ cancelledAt, cancelledByAdminId: req.userId! })
        .where(and(...matchClauses));
    });

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
    // Sign a short-lived prefill token tied to this member so the cancellation
    // email can deep-link straight to the email-change form with the discarded
    // address pre-filled. The token is verified server-side against the
    // authenticated session before any pre-fill occurs, so the URL can't be
    // used to seed a phishing form on someone else's account.
    const prefillToken = signEmailChangePrefillToken({
      userId: id,
      prefillEmail: previousPendingEmail,
    });
    const restartUrl = buildEmailChangeRestartUrl(
      process.env.PORTAL_URL || "https://portal.buildtestscale.com",
      prefillToken,
    );

    CommunicationService.queueEmail({
      templateSlug: "email_change_cancelled_by_admin",
      to: member.email,
      variables: {
        member_name: member.name,
        member_email: member.email,
        cancelled_pending_email: previousPendingEmail,
        restart_url: restartUrl,
      },
      userId: id,
    }).catch((err) =>
      console.error(
        "[Admin] Failed to enqueue email_change_cancelled_by_admin notice:",
        err,
      ),
    );

    // Also notify the previously pending address that the change was
    // cancelled, so anyone watching that inbox for the verification link
    // isn't left wondering why it never arrived. This recipient is *not*
    // the verified account owner, so we use a separate template with
    // simpler copy that omits account-status language and any login-gated
    // settings link. No userId is attached because this address is not
    // tied to a user record. Fire-and-forget for the same reason as above.
    CommunicationService.queueEmail({
      templateSlug: "email_change_cancelled_by_admin_pending",
      to: previousPendingEmail,
      variables: {
        cancelled_pending_email: previousPendingEmail,
      },
    }).catch((err) =>
      console.error(
        "[Admin] Failed to enqueue email_change_cancelled_by_admin_pending notice:",
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

// Friendly display label used inside the `role_changed` notification email
// so the recipient sees "Support Agent" instead of the raw `support_agent`
// identifier. Kept local to this route module on purpose — the admin role
// dropdown is getting its own friendlier-labels treatment in a separate task,
// and we don't want to pre-empt that work by promoting these strings to the
// shared auth package yet.
function roleDisplayLabel(role: string): string {
  switch (role) {
    case "super_admin": return "Super Admin";
    case "admin": return "Admin";
    case "support_agent": return "Support Agent";
    case "content_manager": return "Content Manager";
    case "compliance_reviewer": return "Compliance Reviewer";
    case "member": return "Member";
    default: return role;
  }
}

router.post(
  "/admin/members/:id/role",
  requirePermission("members:assign_role"),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: "Invalid member ID" });
        return;
      }

      const { role: nextRole } = req.body ?? {};
      if (typeof nextRole !== "string" || nextRole.length === 0) {
        res.status(400).json({ error: "role is required" });
        return;
      }
      if (nextRole !== "member" && !isAdminRole(nextRole)) {
        res.status(400).json({
          error: `Invalid role. Allowed roles: ${["member", ...ADMIN_ROLES].join(", ")}`,
        });
        return;
      }

      const [target] = await db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          role: usersTable.role,
        })
        .from(usersTable)
        .where(eq(usersTable.id, id))
        .limit(1);
      if (!target) {
        res.status(404).json({ error: "Member not found" });
        return;
      }

      if (target.role === nextRole) {
        res.status(200).json({ id: target.id, role: target.role, changed: false });
        return;
      }

      // Prevent self-lockout: a super_admin cannot demote themselves.
      if (target.id === req.userId && target.role === "super_admin" && nextRole !== "super_admin") {
        res.status(400).json({
          error: "You cannot remove your own super_admin role.",
        });
        return;
      }

      await db
        .update(usersTable)
        .set({ role: nextRole })
        .where(eq(usersTable.id, id));

      await logAdminAction(
        req,
        "update",
        "user",
        String(id),
        `Changed role for member ${id} from ${target.role} to ${nextRole}`,
        {
          memberEmail: target.email,
          before: { role: target.role },
          after: { role: nextRole },
        },
      );

      // Notify the affected user that their role changed so they're not
      // surprised the next time a feature 403s on them. Fire-and-forget — the
      // role change itself has already succeeded and we never want a transient
      // SendGrid/Redis hiccup to surface as an admin-facing 500. We only send
      // when the role actually changed (the no-op case bailed out above).
      const [actor] = await db
        .select({ name: usersTable.name, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, req.userId!))
        .limit(1);
      const actorLabel =
        actor?.name?.trim() || actor?.email || "a Build Test Scale administrator";

      CommunicationService.queueEmail({
        templateSlug: "role_changed",
        to: target.email,
        variables: {
          member_name: target.name?.trim() || target.email,
          actor_name: actorLabel,
          previous_role_label: roleDisplayLabel(target.role),
          new_role_label: roleDisplayLabel(nextRole),
        },
        userId: target.id,
      }).catch((err) =>
        console.error(
          "[Admin] Failed to enqueue role_changed notice:",
          err,
        ),
      );

      res.json({ id: target.id, role: nextRole, changed: true });
    } catch (error) {
      console.error("[Admin] Assign role error:", error);
      res.status(500).json({ error: "Failed to update role" });
    }
  },
);

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
    const rateLimitAuditFailures = await getRateLimitAuditFailureStatsAggregated();
    const redisStatus = !redisConnected
      ? "down"
      : queueFallbacks.alerting
        ? "degraded"
        : "up";

    // Mirror the production env guard's view of the misconfigured secrets so
    // an admin landing on /admin/system from the notification bell sees
    // exactly which secret is the problem instead of having to cross-
    // reference the bell. Outside production this is always empty (the
    // guard is a no-op there), and we never echo the secret value itself —
    // only its stable id, env var name, title, remediation message, and
    // categorical `state` ("unset" vs. "defaulted") so on-call can tell at
    // a glance whether tokens may have been forged with a known default.
    const missingCriticalSecrets = getMisconfiguredCriticalSecrets().map((s) => ({
      id: s.id,
      envVar: s.envVar,
      title: s.title,
      message: s.message,
      state: getSecretMisconfigurationState(s) ?? "unset",
    }));

    // Treat any rate-limit audit-write failure as a degradation: it means
    // the audit trail security on-callers depend on is silently dropping
    // entries while the 429s themselves keep flowing. Better to flip the
    // top-level status to "degraded" so the banner pops than to leave the
    // System Health page green.
    const overallStatus = !dbOk || queueFallbacks.alerting || !redisConnected || rateLimitAuditFailures.totalCount > 0
      ? "degraded"
      : "healthy";

    // Aggregate every active audit-log retention sweep into a single
    // policies array so the System Health page can render them in one
    // card without having to know which background job owns which
    // action_type. Each entry is the same uniform shape; ordering
    // (queue-fallback first, then auth-rate-limit, then the registry
    // entries in declaration order) is stable so the UI does not jitter
    // between refreshes.
    const auditLogRetention = {
      policies: [
        getQueueFallbackAuditCleanupStatus(),
        getAuthRateLimitAuditCleanupStatus(),
        ...getAuditLogRetentionStatus(),
      ],
    };

    res.json({
      status: overallStatus,
      services: {
        api: { status: "up", uptime: process.uptime() },
        database: { status: dbOk ? "up" : "down", totalUsers: userCount, totalTickets: ticketCount },
        redis: { status: redisStatus, queueFallbacks },
        signupChallenge: { enforced: isSignupChallengeEnforced() },
        abuseRateLimitCleanup: getAbuseRateLimitCleanupStatus(),
        emailChangeAttemptsRetention: getEmailChangeAttemptsRetentionPolicy(),
        emailChangeAttemptsCleanup: getEmailChangeAttemptsCleanupStatus(),
        auditLogRetention,
        rateLimitAuditFailures,
        missingCriticalSecrets,
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
 *
 * In addition to the per-row events, the response includes a `stats` object
 * grouping the outcomes of *all* alert deliveries within a rolling window
 * (default 1h) so the System Health UI can show a one-line summary
 * ("last hour: 4 sent · 1 failed · 2 throttled") above the table without
 * making a second round-trip. The window is independent of `limit` so the
 * counter stays accurate even when fewer than 20 rows fit on screen.
 *
 * Admins can ask for a wider window via the `statsWindowMs` query param —
 * useful the morning after an overnight incident ("did we page anyone
 * overnight?"). The param is restricted to a small allow-list so we can't
 * be coerced into a full table scan from the URL bar; anything else falls
 * back to the 1h default.
 */
const QUEUE_FALLBACK_ALERT_STATS_WINDOW_MS = 60 * 60 * 1000;
const QUEUE_FALLBACK_ALERT_STATS_WINDOW_MS_24H = 24 * 60 * 60 * 1000;
const QUEUE_FALLBACK_ALERT_STATS_WINDOW_ALLOWLIST = new Set<number>([
  QUEUE_FALLBACK_ALERT_STATS_WINDOW_MS,
  QUEUE_FALLBACK_ALERT_STATS_WINDOW_MS_24H,
]);
router.get("/admin/system/queue-fallback-alert-events", requirePermission("system:view"), async (req: Request, res: Response) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

    const rawStatsWindow = Number.parseInt(String(req.query.statsWindowMs ?? ""), 10);
    const statsWindowMs = Number.isFinite(rawStatsWindow) && QUEUE_FALLBACK_ALERT_STATS_WINDOW_ALLOWLIST.has(rawStatsWindow)
      ? rawStatsWindow
      : QUEUE_FALLBACK_ALERT_STATS_WINDOW_MS;

    // Optional outcome / deliveryChannel filters applied server-side so the
    // row limit stays meaningful when an on-call admin narrows the view.
    // Unknown / unsupported values are coerced to null so callers don't get
    // surprise empty results — the response echoes back what was applied.
    // The rolling stats query intentionally ignores these filters so the
    // last-hour summary stays accurate as a situational overview regardless
    // of how the table view is narrowed.
    const outcomeParam = typeof req.query.outcome === "string" ? req.query.outcome : null;
    const outcomeFilter: "sent" | "failed" | "throttled" | "skipped" | null =
      outcomeParam === "sent" || outcomeParam === "failed" || outcomeParam === "throttled" || outcomeParam === "skipped"
        ? outcomeParam
        : null;

    const deliveryChannelParam = typeof req.query.deliveryChannel === "string" ? req.query.deliveryChannel : null;
    const deliveryChannelFilter: "pagerduty" | "email" | "slack" | null =
      deliveryChannelParam === "pagerduty" || deliveryChannelParam === "email" || deliveryChannelParam === "slack"
        ? deliveryChannelParam
        : null;

    const baseFilter = and(
      eq(auditLogTable.actionType, QUEUE_FALLBACK_ALERT_ACTION_TYPE),
      eq(auditLogTable.entityType, QUEUE_FALLBACK_ALERT_ENTITY_TYPE),
    );

    const rowConditions = [
      eq(auditLogTable.actionType, QUEUE_FALLBACK_ALERT_ACTION_TYPE),
      eq(auditLogTable.entityType, QUEUE_FALLBACK_ALERT_ENTITY_TYPE),
    ];
    if (outcomeFilter) {
      rowConditions.push(sql`${auditLogTable.metadata}->>'outcome' = ${outcomeFilter}`);
    }
    if (deliveryChannelFilter) {
      rowConditions.push(sql`${auditLogTable.metadata}->>'deliveryChannel' = ${deliveryChannelFilter}`);
    }

    const statsSince = new Date(Date.now() - statsWindowMs);
    const outcomeExpr = sql<string>`COALESCE(${auditLogTable.metadata}->>'outcome', 'unknown')`;
    // Also group by deliveryChannel so the summary can answer "which channel
    // is broken?" — not just "did pages go out?". An unrecognized or missing
    // deliveryChannel is bucketed as 'unknown' so it can't silently disappear.
    const deliveryChannelExpr = sql<string>`COALESCE(${auditLogTable.metadata}->>'deliveryChannel', 'unknown')`;
    const [rows, statsRows] = await Promise.all([
      db
        .select({
          id: auditLogTable.id,
          createdAt: auditLogTable.createdAt,
          entityId: auditLogTable.entityId,
          description: auditLogTable.description,
          metadata: auditLogTable.metadata,
        })
        .from(auditLogTable)
        .where(and(...rowConditions))
        .orderBy(desc(auditLogTable.createdAt))
        .limit(limit),
      db
        .select({
          outcome: outcomeExpr,
          deliveryChannel: deliveryChannelExpr,
          count: sql<number>`count(*)`,
        })
        .from(auditLogTable)
        .where(and(baseFilter, gte(auditLogTable.createdAt, statsSince)))
        .groupBy(outcomeExpr, deliveryChannelExpr),
    ]);

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

    type AlertStatsBucket = {
      sent: number;
      failed: number;
      throttled: number;
      skipped: number;
      unknown: number;
      total: number;
    };
    const emptyBucket = (): AlertStatsBucket => ({
      sent: 0, failed: 0, throttled: 0, skipped: 0, unknown: 0, total: 0,
    });
    const stats = emptyBucket();
    // Always emit all four channel buckets (with zeros) so the frontend can
    // render a stable layout without conditional-key handling. 'unknown'
    // captures rows whose deliveryChannel didn't match a known destination.
    const byChannel: Record<"pagerduty" | "email" | "slack" | "unknown", AlertStatsBucket> = {
      pagerduty: emptyBucket(),
      email: emptyBucket(),
      slack: emptyBucket(),
      unknown: emptyBucket(),
    };
    for (const row of statsRows) {
      const count = Number(row.count) || 0;
      const outcomeKey: keyof AlertStatsBucket =
        row.outcome === "sent" || row.outcome === "failed" || row.outcome === "throttled" || row.outcome === "skipped"
          ? row.outcome
          : "unknown";
      const channelKey: keyof typeof byChannel =
        row.deliveryChannel === "pagerduty" || row.deliveryChannel === "email" || row.deliveryChannel === "slack"
          ? row.deliveryChannel
          : "unknown";
      stats[outcomeKey] += count;
      stats.total += count;
      byChannel[channelKey][outcomeKey] += count;
      byChannel[channelKey].total += count;
    }

    res.json({
      events,
      limit,
      filters: {
        outcome: outcomeFilter,
        deliveryChannel: deliveryChannelFilter,
      },
      stats: { windowMs: statsWindowMs, ...stats, byChannel },
    });
  } catch (error) {
    console.error("[Admin] Queue fallback alert events error:", error);
    res.status(500).json({ error: "Failed to fetch queue fallback alert events" });
  }
});

/**
 * Live snapshot of the on-call alerter's runtime state for the admin
 * System Health page.
 *
 * The other queue-fallback endpoints answer historical questions ("what
 * fallbacks happened?", "what alert deliveries were attempted?"). This one
 * answers operator-during-an-outage questions:
 *
 *   - Per-channel "is the alerter currently in the alerting state?" flag.
 *   - Last fire/clear timestamp per channel (so it's obvious whether the
 *     alerting flag was just flipped or has been stuck on for hours).
 *   - Each currently held throttle slot with its remaining TTL, so the
 *     operator can see *why* a follow-up page hasn't gone out yet.
 *
 * The alerting flags + throttle slots come straight from the cluster-shared
 * Redis state (with the per-pod in-memory fallback the alerter itself uses).
 * The last-transition timestamps come from the audit log rows that
 * `recordDeliveryAttempt` writes for every fire/clear delivery — those rows
 * survive restarts and are written cluster-wide, so the answer is the same
 * regardless of which pod served this request.
 *
 * Read-only: no mutation surface. Tuning the throttle window or clearing a
 * stuck flag is intentionally out of scope here.
 */
router.get("/admin/system/queue-fallback-alerter-health", requirePermission("system:view"), async (_req: Request, res: Response) => {
  try {
    const channels = ["email", "sms"] as const;
    type Channel = (typeof channels)[number];
    type Kind = "fire" | "clear";

    const [alertingSnapshot, throttleSnapshot, lastTransitions] = await Promise.all([
      getAlertingFlags(),
      getActiveThrottleSlots(),
      // One MAX(createdAt) per (queueChannel, kind). Filtering on
      // metadata->>'queueChannel' avoids picking up rows whose entityId
      // got a non-channel value, and also lets us keep the audit-row
      // outcome (sent/throttled/skipped/failed) out of the picture: we
      // only care *when* the alerter last attempted a transition, not
      // whether the page actually went out.
      db
        .select({
          queueChannel: sql<string>`COALESCE(${auditLogTable.metadata}->>'queueChannel', ${auditLogTable.entityId})`.as("queue_channel"),
          kind: sql<string>`${auditLogTable.metadata}->>'kind'`.as("kind"),
          lastAt: sql<Date>`MAX(${auditLogTable.createdAt})`.as("last_at"),
        })
        .from(auditLogTable)
        .where(and(
          eq(auditLogTable.actionType, QUEUE_FALLBACK_ALERT_ACTION_TYPE),
          eq(auditLogTable.entityType, QUEUE_FALLBACK_ALERT_ENTITY_TYPE),
        ))
        .groupBy(
          sql`COALESCE(${auditLogTable.metadata}->>'queueChannel', ${auditLogTable.entityId})`,
          sql`${auditLogTable.metadata}->>'kind'`,
        ),
    ]);

    const lastByChannelKind: Record<Channel, Record<Kind, string | null>> = {
      email: { fire: null, clear: null },
      sms: { fire: null, clear: null },
    };
    for (const row of lastTransitions) {
      const ch = row.queueChannel as string | null;
      const kind = row.kind as string | null;
      if (ch !== "email" && ch !== "sms") continue;
      if (kind !== "fire" && kind !== "clear") continue;
      const lastAt = row.lastAt instanceof Date ? row.lastAt.toISOString() : (row.lastAt ? new Date(row.lastAt as unknown as string).toISOString() : null);
      lastByChannelKind[ch][kind] = lastAt;
    }

    const flagByChannel: Record<Channel, boolean> = { email: false, sms: false };
    for (const f of alertingSnapshot.flags) flagByChannel[f.channel] = f.alerting;

    res.json({
      // The two snapshots have independent fallback paths (Redis can fail
      // for one read but succeed for the other). Reporting both lets the UI
      // distinguish "throttle slots are empty cluster-wide" from "throttle
      // slots are empty *on this pod's in-memory map*".
      alertingSource: alertingSnapshot.source,
      throttleSource: throttleSnapshot.source,
      channels: channels.map((ch) => ({
        channel: ch,
        alerting: flagByChannel[ch],
        lastFireAt: lastByChannelKind[ch].fire,
        lastClearAt: lastByChannelKind[ch].clear,
      })),
      throttles: throttleSnapshot.slots,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Admin] Queue fallback alerter health error:", error);
    res.status(500).json({ error: "Failed to fetch on-call alerter health" });
  }
});

router.get("/admin/notifications", requirePermission("notifications:view"), async (req: Request, res: Response) => {
  try {
    // Optional `?limit=N` lets the bell dropdown cap how many items it pulls
    // each minute. During a sync storm or runaway alerter the unbounded
    // payload can grow into the hundreds, which is wasteful on the wire and
    // slow to render in a 320px popover. We clamp to a small absolute max so
    // a malicious or buggy caller can't ask the server to materialize an
    // arbitrarily large list. When the param is absent we keep returning the
    // raw array for backwards compatibility with anything still calling the
    // unparameterized endpoint.
    const HARD_MAX_LIMIT = 200;
    let limit: number | null = null;
    if (typeof req.query.limit === "string" && req.query.limit.length > 0) {
      // Strict integer parse: `parseInt` would silently accept "1.5" (→1) or
      // "10abc" (→10), so validate the raw string first. Anything that isn't
      // pure digits is rejected so a stale/buggy caller doesn't get a
      // surprise truncation that doesn't match what they asked for.
      if (!/^\d+$/.test(req.query.limit)) {
        res.status(400).json({ error: "limit must be a positive integer" });
        return;
      }
      const parsed = Number.parseInt(req.query.limit, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        res.status(400).json({ error: "limit must be a positive integer" });
        return;
      }
      limit = Math.min(parsed, HARD_MAX_LIMIT);
    }

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

    // Surface the rate-limit audit-failure alerter's state in the bell so
    // an admin sees "audit writes are being dropped" without first opening
    // System Health — the whole point of the alerter pipeline. Mirrors how
    // `queue_fallback` is surfaced just above. Also fan out to the on-call
    // alert pipeline so this also pages PagerDuty/email/Slack — that path
    // throttles itself per delivery channel so this fires at most once
    // per window even though /admin/notifications is polled every minute.
    const auditFailureStats = getRateLimitAuditFailureStats();
    const auditFailureAlerting = getRateLimitAuditFailureAlertingState();
    if (auditFailureAlerting.alerting) {
      notifications.push({
        id: "rate-limit-audit-failure",
        type: "rate_limit_audit_failure",
        severity: "high",
        title: "Rate-limit audit writes are silently dropping",
        message: `${auditFailureStats.totalCount} audit row(s) have been dropped since process start — the 429s are still going out, but the audit trail isn't. Database may be flapping during a credential-stuffing wave.`,
        link: "/admin/system",
        createdAt: auditFailureStats.lastAt ?? new Date().toISOString(),
      });
    }
    // Always evaluate so on-call gets paged on the first dropped-row burst
    // even if the admin bell hasn't yet flipped to "alerting" (the bell
    // reads the alerter state, the alerter sets it from this evaluation).
    // Don't await — alerting on the dashboard fetch path shouldn't block
    // the response, and the alerter logs its own errors.
    evaluateRateLimitAuditFailureAlert().catch((err) => {
      console.error("[Admin] rate-limit audit-failure alerter dispatch failed:", err);
    });

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

    if (limit !== null) {
      // Most-recent-first so when the bell truncates to N items, admins see
      // the freshest signal during an incident — not whichever happens to be
      // appended first by the evaluation pipeline above. The sort is stable
      // for identical timestamps, which matters because most of these
      // notifications are stamped at request time and would otherwise scramble
      // run-to-run, breaking snapshot/e2e expectations.
      const sorted = [...notifications].sort((a, b) => {
        if (a.createdAt === b.createdAt) return 0;
        return a.createdAt < b.createdAt ? 1 : -1;
      });
      res.json({
        notifications: sorted.slice(0, limit),
        total: notifications.length,
      });
      return;
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
    // ciphertext blob into the generic Settings page. Auth rate-limit alert
    // thresholds are also hidden here because they have their own dedicated
    // card with bounds enforcement and reset-to-defaults UX — editing them
    // as raw JSON in the generic list bypasses the bounds and would let an
    // admin save a value the alert engine can't actually use.
    const filtered = settings.filter(
      (s) =>
        !isOnCallSettingKey(s.key) &&
        !isAuthRateLimitAlertSettingKey(s.key) &&
        !isChangeHistoryRetentionSettingKey(s.key),
    );
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
    if (isAuthRateLimitAlertSettingKey(key)) {
      res.status(400).json({ error: "Use /admin/auth-rate-limit-alert-config to manage auth rate-limit alert thresholds" });
      return;
    }
    if (isChangeHistoryRetentionSettingKey(key)) {
      res.status(400).json({ error: "Use /admin/change-history-retention-config to manage change-history retention windows" });
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
    // Track non-null saved values per field so we can probe them after the
    // save completes. We probe *after* the row is written so that even if
    // the probe explodes, the value the admin asked us to store is durable.
    const probeTargets = new Map<OnCallField, string>();
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
      if (value !== null) probeTargets.set(field, value);
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

    // Lightweight per-channel reachability probe so admins get a green check
    // / red cross inline instead of having to run a full fire+clear test
    // separately. Probes run in parallel and never throw — failures degrade
    // to a `{ok:false, reason}` entry in the response. The save itself has
    // already committed regardless of probe outcome.
    const probes: Partial<Record<OnCallField, ProbeResult>> = {};
    const probeRuns: Array<Promise<void>> = [];
    for (const [field, value] of probeTargets) {
      probeRuns.push(
        runProbeForField(field, value).then((result) => {
          probes[field] = result;
        }),
      );
    }
    await Promise.all(probeRuns);

    // Audit the probe outcomes so we can later answer "did the save show a
    // red cross at the time?" without re-probing the destination. We only
    // audit the outcome (ok / skipped / reason) — never the value itself,
    // matching how the change-list audit row above redacts secrets.
    const probeAuditEntries = Object.entries(probes).map(([field, result]) => ({
      field,
      ok: result.ok,
      skipped: !!result.skipped,
      reason: result.reason ?? null,
    }));
    if (probeAuditEntries.length > 0) {
      await logAdminAction(
        req,
        "probe_oncall_destination",
        "oncall_destinations",
        "oncall",
        `Probed on-call destination(s): ${probeAuditEntries
          .map((p) => `${p.field}=${p.skipped ? "skipped" : p.ok ? "ok" : "failed"}`)
          .join(", ")}`,
        { probes: probeAuditEntries },
      );
    }

    const status = await getOnCallDestinationsStatus();
    res.json({ ...status, probes });
  } catch (error) {
    console.error("[Admin] Update on-call destinations error:", error);
    res.status(500).json({ error: "Failed to update on-call destinations" });
  }
});

async function runProbeForField(field: OnCallField, value: string): Promise<ProbeResult> {
  switch (field) {
    case "pagerdutyIntegrationKey":
      return probePagerDutyDestination(value);
    case "opsAlertEmail":
      return probeEmailDestination(value);
    case "opsAlertSlackWebhookUrl":
      return probeSlackDestination(value);
  }
}

const ALL_ONCALL_FIELDS: ReadonlyArray<OnCallField> = [
  "pagerdutyIntegrationKey",
  "opsAlertEmail",
  "opsAlertSlackWebhookUrl",
];

/**
 * Re-run a single channel's reachability probe against the currently-stored
 * destination value, without requiring the admin to retype the secret. Used
 * by the "Re-test" button on each saved on-call row so admins can verify a
 * previously-saved Slack webhook (or PagerDuty key, or ops email) still
 * works after, e.g., a Slack workspace migration.
 *
 * The stored value is read server-side and never sent to the client — the
 * response only carries the probe outcome. The probe is also audit-logged
 * with the same `probe_oncall_destination` action type used by the bulk
 * save flow so the timeline shows every reachability check uniformly.
 */
router.post(
  "/admin/oncall-destinations/:field/probe",
  requirePermission("settings:manage"),
  async (req: Request, res: Response) => {
    try {
      const { field } = req.params;
      if (!ALL_ONCALL_FIELDS.includes(field as OnCallField)) {
        res.status(400).json({ error: `Unknown on-call field: ${field}` });
        return;
      }
      const typedField = field as OnCallField;

      // Resolve the value the alerter would actually use (DB-saved value
      // wins over env fallback). This mirrors the dispatch path so the
      // probe exercises the exact destination "fire" alerts will hit.
      const destinations = await getOnCallDestinations();
      const value = destinations[typedField];

      if (value == null || value === "") {
        // No value to probe — return a skipped result with a stable reason
        // so the UI can render the same badge as the save flow does for
        // unconfigured rows. We deliberately don't 4xx here so the client
        // can keep its state machine simple (always read `probe` off the
        // response).
        const probe: ProbeResult = { ok: false, skipped: true, reason: "not_configured" };
        res.json({ probe });
        return;
      }

      const probe = await runProbeForField(typedField, value);

      // Audit the re-test outcome so we can later answer "when did this
      // destination last show a green check?" without re-probing. We only
      // record the outcome (ok / skipped / reason) — never the value, in
      // line with the bulk save flow's audit redaction.
      await logAdminAction(
        req,
        "probe_oncall_destination",
        "oncall_destinations",
        "oncall",
        `Re-tested on-call destination: ${typedField}=${
          probe.skipped ? "skipped" : probe.ok ? "ok" : "failed"
        }`,
        {
          probes: [
            {
              field: typedField,
              ok: probe.ok,
              skipped: !!probe.skipped,
              reason: probe.reason ?? null,
            },
          ],
        },
      );

      res.json({ probe });
    } catch (error) {
      console.error("[Admin] Re-probe on-call destination error:", error);
      res.status(500).json({ error: "Failed to probe on-call destination" });
    }
  },
);

/**
 * Read the current auth rate-limit alert thresholds plus their defaults and
 * accepted bounds. The bounds are returned alongside the values so the admin
 * UI can mirror the server's validation without hard-coding it.
 */
router.get("/admin/auth-rate-limit-alert-config", requirePermission("settings:view"), async (_req: Request, res: Response) => {
  try {
    const status = await getAuthRateLimitAlertConfigStatus();
    res.json(status);
  } catch (error) {
    console.error("[Admin] Get auth rate-limit alert config error:", error);
    res.status(500).json({ error: "Failed to fetch auth rate-limit alert config" });
  }
});

/**
 * Update one or more of the auth rate-limit alert thresholds. Body is a
 * partial — any field omitted is left untouched. Out-of-bounds values are
 * rejected with a 400 listing every invalid field at once so the UI can
 * surface them inline. Successful saves are recorded in the audit log with
 * the before/after values per changed field, and the in-process cache is
 * invalidated so the dashboard reflects the new thresholds on its next read.
 */
router.put("/admin/auth-rate-limit-alert-config", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const validation = validateAuthRateLimitAlertUpdate(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: "Invalid alert config", fieldErrors: validation.errors });
      return;
    }
    const { before, after, changedFields } = await applyAuthRateLimitAlertConfigUpdate(
      validation.update,
      req.userEmail || (req.userId ? String(req.userId) : null),
    );
    if (changedFields.length > 0) {
      const diff: Record<string, { from: number; to: number }> = {};
      for (const field of changedFields) {
        diff[field] = { from: before[field], to: after[field] };
      }
      await logAdminAction(
        req,
        "update_setting",
        "auth_rate_limit_alert_config",
        "auth_rate_limit_alert",
        `Updated auth rate-limit alert config: ${changedFields.join(", ")}`,
        { changedFields, diff },
      );
    }
    const status = await getAuthRateLimitAlertConfigStatus();
    res.json({ ...status, changedFields });
  } catch (error) {
    console.error("[Admin] Update auth rate-limit alert config error:", error);
    res.status(500).json({ error: "Failed to update auth rate-limit alert config" });
  }
});

/**
 * Read the current change-history retention windows (one per channel: email
 * and phone) plus their defaults and accepted bounds. The bounds are returned
 * alongside the values so the admin UI can mirror the server's validation
 * without hard-coding it. Both cleanup jobs read these values at runtime, so
 * a save here takes effect on the next scheduled tick (no restart needed).
 */
router.get("/admin/change-history-retention-config", requirePermission("settings:view"), async (_req: Request, res: Response) => {
  try {
    const status = await getChangeHistoryRetentionConfigStatus();
    res.json(status);
  } catch (error) {
    console.error("[Admin] Get change-history retention config error:", error);
    res.status(500).json({ error: "Failed to fetch change-history retention config" });
  }
});

/**
 * Update one or both of the change-history retention windows. Body is a
 * partial — any field omitted is left untouched. A `null` field value means
 * "reset to default" (the underlying row is deleted so per-field provenance
 * flips back to "default"). Out-of-bounds values are rejected with a 400
 * listing every invalid field at once. Successful saves are recorded in the
 * audit log with the before/after values per changed field.
 */
router.put("/admin/change-history-retention-config", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const validation = validateChangeHistoryRetentionUpdate(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: "Invalid retention config", fieldErrors: validation.errors });
      return;
    }
    const { before, after, changedFields } = await applyChangeHistoryRetentionConfigUpdate(
      validation.update,
      req.userEmail || (req.userId ? String(req.userId) : null),
    );
    if (changedFields.length > 0) {
      const diff: Record<string, { from: number; to: number }> = {};
      for (const field of changedFields) {
        diff[field] = { from: before[field], to: after[field] };
      }
      await logAdminAction(
        req,
        "update_setting",
        "change_history_retention_config",
        "change_history_retention",
        `Updated change-history retention: ${changedFields.join(", ")}`,
        { changedFields, diff },
      );
    }
    const status = await getChangeHistoryRetentionConfigStatus();
    res.json({ ...status, changedFields });
  } catch (error) {
    console.error("[Admin] Update change-history retention config error:", error);
    res.status(500).json({ error: "Failed to update change-history retention config" });
  }
});

/**
 * Recent change history for the on-call destinations card.
 *
 * Filters audit_log down to rows whose `entityType = "oncall_destinations"` —
 * which today covers two action types written by the endpoints above:
 *   - "update_setting"  — admin edited PagerDuty / ops email / Slack webhook
 *                         (changeDiff carries `{ changedFields: [...] }`,
 *                         never the new secret value itself)
 *   - "send_test_alert" — admin clicked "Send test alert"
 *                         (changeDiff carries the per-channel results summary)
 *
 * `probe_oncall_destination` rows are intentionally excluded here — the
 * recent-changes UI is not built to render them and they have a dedicated
 * per-channel disclosure backed by `/admin/oncall-destinations/probes` so
 * each probe outcome already has a home next to its destination row.
 *
 * Joining `usersTable` lets us return the admin's display name without making
 * the UI fan out a second lookup per row. The join is `leftJoin` because the
 * actor reference is nullable (e.g. system-initiated audit rows would not
 * have one), and we still want those rows to show up in the history.
 *
 * Query params:
 *   - limit: number of events to return (default 10, max 50). Tuned small by
 *     default because the card just needs the "last few changes" — admins
 *     who want the full history can drill into the dedicated Audit Log page.
 */
router.get("/admin/oncall-destinations/history", requirePermission("settings:view"), async (req: Request, res: Response) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? "10"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 10;

    const rows = await db
      .select({
        id: auditLogTable.id,
        createdAt: auditLogTable.createdAt,
        actionType: auditLogTable.actionType,
        actorId: auditLogTable.actorId,
        actorEmail: auditLogTable.actorEmail,
        actorName: usersTable.name,
        description: auditLogTable.description,
        changeDiff: auditLogTable.changeDiff,
      })
      .from(auditLogTable)
      .leftJoin(usersTable, eq(auditLogTable.actorId, usersTable.id))
      .where(
        and(
          eq(auditLogTable.entityType, "oncall_destinations"),
          ne(auditLogTable.actionType, "probe_oncall_destination"),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
      .limit(limit);

    const events = rows.map((row) => {
      const diff = (row.changeDiff ?? {}) as Record<string, unknown>;

      // For "update_setting" rows, the writer puts the touched fields in
      // `changedFields`. Filter to the known on-call field names so a future
      // schema change can't sneak an unexpected string into the UI.
      const changedFieldsRaw = Array.isArray(diff.changedFields) ? diff.changedFields : [];
      const allowedFields: OnCallField[] = ["pagerdutyIntegrationKey", "opsAlertEmail", "opsAlertSlackWebhookUrl"];
      const changedFields = changedFieldsRaw.filter(
        (f): f is OnCallField => typeof f === "string" && (allowedFields as string[]).includes(f),
      );

      // For "send_test_alert" rows, the writer puts a per-channel summary in
      // `results`. Same defensive narrowing — only let through entries with
      // the shape the UI knows how to render.
      const resultsRaw = Array.isArray(diff.results) ? diff.results : [];
      const testResults = resultsRaw
        .map((r) => {
          if (!r || typeof r !== "object") return null;
          const rec = r as Record<string, unknown>;
          const channel = typeof rec.channel === "string" ? rec.channel : null;
          if (channel !== "pagerduty" && channel !== "email" && channel !== "slack") return null;
          return {
            channel,
            ok: rec.ok === true,
            skipped: rec.skipped === true,
            reason: typeof rec.reason === "string" ? rec.reason : null,
          };
        })
        .filter((r): r is { channel: "pagerduty" | "email" | "slack"; ok: boolean; skipped: boolean; reason: string | null } => r !== null);

      return {
        id: row.id,
        createdAt: row.createdAt,
        actionType: row.actionType,
        actorId: row.actorId,
        actorEmail: row.actorEmail,
        actorName: row.actorName,
        description: row.description,
        changedFields,
        testResults,
      };
    });

    res.json({ events, limit });
  } catch (error) {
    console.error("[Admin] On-call destinations history error:", error);
    res.status(500).json({ error: "Failed to fetch on-call destinations history" });
  }
});

/**
 * Recent reachability-probe history for a single on-call destination channel.
 *
 * Each PUT to `/admin/oncall-destinations` writes a `probe_oncall_destination`
 * audit row whose `changeDiff.probes` array carries one entry per touched
 * field (`{ field, ok, skipped, reason }`). This endpoint walks those rows
 * newest-first and pulls out only the entries matching `?field=...`, so the
 * settings card can show "the last 10 times we tried PagerDuty" without the
 * admin having to open the dedicated Audit Log page and decode JSON by hand.
 *
 * We over-scan (limit * 5, capped at 250) because a single audit row may
 * cover one to three fields — the channel of interest may not appear in
 * every probe row. The over-scan keeps the response well-bounded while
 * still returning a full page in the common case.
 *
 * Query params:
 *   - field: required, one of the OnCallField names. Anything else returns
 *     a 400 listing the accepted values.
 *   - limit: per-channel result count, default 10, clamped to 1..50 to match
 *     the sibling `/history` endpoint.
 */
router.get("/admin/oncall-destinations/probes", requirePermission("settings:view"), async (req: Request, res: Response) => {
  try {
    const allowedFields: OnCallField[] = ["pagerdutyIntegrationKey", "opsAlertEmail", "opsAlertSlackWebhookUrl"];
    const fieldRaw = req.query.field;
    if (typeof fieldRaw !== "string" || !(allowedFields as string[]).includes(fieldRaw)) {
      res.status(400).json({
        error: `field is required and must be one of: ${allowedFields.join(", ")}`,
      });
      return;
    }
    const field = fieldRaw as OnCallField;

    const rawLimit = Number.parseInt(String(req.query.limit ?? "10"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 10;
    const scanLimit = Math.min(limit * 5, 250);

    const rows = await db
      .select({
        id: auditLogTable.id,
        createdAt: auditLogTable.createdAt,
        changeDiff: auditLogTable.changeDiff,
      })
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.entityType, "oncall_destinations"),
          eq(auditLogTable.actionType, "probe_oncall_destination"),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
      .limit(scanLimit);

    const probes: Array<{
      id: number;
      createdAt: Date;
      ok: boolean;
      skipped: boolean;
      reason: string | null;
    }> = [];
    for (const row of rows) {
      const diff = (row.changeDiff ?? {}) as Record<string, unknown>;
      const probesArr = Array.isArray(diff.probes) ? diff.probes : [];
      for (const p of probesArr) {
        if (!p || typeof p !== "object") continue;
        const rec = p as Record<string, unknown>;
        if (rec.field !== field) continue;
        probes.push({
          id: row.id,
          createdAt: row.createdAt,
          ok: rec.ok === true,
          skipped: rec.skipped === true,
          reason: typeof rec.reason === "string" ? rec.reason : null,
        });
        // Each save writes at most one entry per field, so we can break out
        // of the inner loop as soon as we find this field's result for the
        // current audit row.
        break;
      }
      if (probes.length >= limit) break;
    }

    res.json({ field, probes, limit });
  } catch (error) {
    console.error("[Admin] On-call destination probe history error:", error);
    res.status(500).json({ error: "Failed to fetch on-call destination probe history" });
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
