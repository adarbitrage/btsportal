import { getParam } from "../lib/params";
import { PRODUCT_RANK } from "../lib/product-rank";
import { getProductLabelByRank } from "../lib/entitlements";
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db, usersTable, userProductsTable, productsTable, ticketsTable, auditLogTable, systemSettingsTable, adminNotesTable, progressTable, emailChangeHistoryTable, emailChangeAttemptsTable, phoneChangeHistoryTable, webhookLogsTable, machineProductKeyMappingsTable, machineUnknownProductKeysTable, sessionsTable } from "@workspace/db";
import { eq, ne, and, gt, gte, lt, lte, desc, asc, sql, ilike, or, inArray, isNotNull, isNull, getTableColumns, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ADMIN_ROLES, hasPermission, isAdminRole, requirePermission } from "../middleware/rbac";
import { isSignupChallengeEnforced } from "../middleware/captcha";
import { logAdminAction, logAuditEvent, redactAuditRowPii } from "../lib/audit-log";
import { computeOrderMismatch, parsePortalProductKeys } from "../lib/external-order-mismatch";
import { CommunicationService } from "../lib/communication-service";
import {
  signEmailChangePrefillToken,
  buildEmailChangeRestartUrl,
} from "../lib/email-change-prefill-token";
import { isRedisConnected } from "../lib/redis";
import { getQueueFallbackStatsFromDb } from "../lib/queue-fallback-tracker";
import { getAbuseRateLimitCleanupStatus } from "../lib/abuse-rate-limit-cleanup";
import {
  getCoachingCallTemplateTopUpStatus,
  getCoachingCallTemplateTopUpHealth,
} from "../lib/coaching-call-template-topup";
import { getUpgradePromptEventsCleanupStatus } from "../lib/upgrade-prompt-events-cleanup";
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
import { getMachineMismatchDigestStatus } from "../lib/machine-mismatch-daily-digest";
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
import {
  getCachedRetellSetupResult,
  setCachedRetellSetupResult,
  interpretRetellSetupHealth,
  probeRetellAgentHealth,
} from "../lib/retell-agent-setup";
import { getRetellAgentAlertingState } from "../lib/retell-agent-alerter";
import { AUTH_RATE_LIMIT_AUDIT_ACTION } from "./auth";
import {
  getOnCallDestinations,
  getOnCallDestinationsStatus,
  setOnCallDestination,
  isOnCallSettingKey,
  getDigestAlerterTuningStatus,
  applyDigestAlerterTuningUpdate,
  validateDigestAlerterTuningUpdate,
  type OnCallField,
  type DigestAlerterTuningField,
} from "../lib/oncall-settings";
import {
  getAuthRateLimitAlertConfigStatus,
  applyAuthRateLimitAlertConfigUpdate,
  validateUpdate as validateAuthRateLimitAlertUpdate,
  isAuthRateLimitAlertSettingKey,
} from "../lib/auth-rate-limit-alert-settings";
import {
  getMachineMismatchAlertConfigStatus,
  applyMachineMismatchAlertConfigUpdate,
  validateUpdate as validateMachineMismatchAlertUpdate,
  isMachineMismatchAlertSettingKey,
} from "../lib/machine-mismatch-alert-settings";
import {
  getModerationFailureAlertConfigStatus,
  applyModerationFailureAlertConfigUpdate,
  validateUpdate as validateModerationFailureAlertUpdate,
  isModerationFailureAlertSettingKey,
} from "../lib/moderation/failure-alert-settings";
import {
  getAiModerationThresholdConfigStatus,
  applyAiModerationThresholdConfigUpdate,
  validateUpdate as validateAiModerationThresholdUpdate,
  isAiModerationThresholdSettingKey,
  computeAiThresholdPreview,
  AI_MODERATION_THRESHOLD_BOUNDS,
} from "../lib/moderation/ai-threshold-settings";
import {
  getModerationFailuresInWindowAggregated,
  getModerationFailureCumulativeStats,
} from "../lib/moderation/failure-tracker";
import {
  evaluateModerationFailureAlert,
  getModerationFailureAlertingState,
  evaluateModerationPodSilentAlert,
  getModerationPodSilentAlertingState,
} from "../lib/moderation/failure-alerter";
import {
  getCommsDedupFailuresInWindow,
  getCommsDedupFailureCumulativeStats,
} from "../lib/comms-dedup-failure-tracker";
import {
  evaluateCommsDedupFailureAlert,
  getCommsDedupFailureAlertingState,
} from "../lib/comms-dedup-failure-alerter";
import { getStuckTicketDeliveryStats } from "../lib/ticketdesk-queue";
import {
  evaluateTicketDeskDeliveryAlert,
  getTicketDeskDeliveryAlertingState,
} from "../lib/ticketdesk-delivery-alerter";
import { MACHINE_MISMATCH_ALERT_ACTION_TYPE } from "../lib/machine-mismatch-alerter";
import { RETELL_AGENT_ALERT_ACTION_TYPE } from "../lib/retell-agent-alerter";
import {
  getLiveChatEmbedProbeState,
  getLiveChatEmbedProbeUrl,
} from "../lib/live-chat-embed-probe";
import { getTicketDeskDeliveryProbeState } from "../lib/ticketdesk-delivery-probe";
import {
  DEFAULT_TICKETDESK_URL,
  DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL,
} from "@workspace/support-config";
import {
  MACHINE_MISMATCH_DIGEST_ALERT_ACTION_TYPE,
  getMachineMismatchDigestWatchdogState,
} from "../lib/machine-mismatch-digest-alerter";
import {
  getAuthRateLimitAlertTrafficPreview,
  coerceLookbackDays as coerceAlertTrafficPreviewLookbackDays,
} from "../lib/auth-rate-limit-alert-traffic-preview";
import {
  getChangeHistoryRetentionConfigStatus,
  applyChangeHistoryRetentionConfigUpdate,
  validateUpdate as validateChangeHistoryRetentionUpdate,
  isChangeHistoryRetentionSettingKey,
} from "../lib/change-history-retention-settings";
import {
  getPortalUrl,
  getPortalUrlStatus,
  setPortalUrl,
  isPortalUrlSettingKey,
  PORTAL_URL_SETTING_KEY,
} from "../lib/portal-url-settings";
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

// ---------------------------------------------------------------------------
// Level-rank SQL helpers — built once at module load from the authoritative
// PRODUCT_RANK map so no parallel rank table can diverge.
// ---------------------------------------------------------------------------

/**
 * SQL CASE fragment that maps products.slug → its tier rank number.
 * Slugs not in PRODUCT_RANK receive ELSE 0 (front-end level).
 */
const LEVEL_RANK_CASE_SQL = Object.entries(PRODUCT_RANK)
  .map(([slug, rank]) => `WHEN p.slug = '${slug.replace(/'/g, "''")}' THEN ${rank}`)
  .join(" ");

/**
 * Correlated subquery: COALESCE(MAX(tier rank of active non-expired grants), -1).
 * Returns -1 when a user owns no active products (sentinel for "Free").
 * Active/non-expired scoping mirrors getUserEntitlements.
 */
const LEVEL_RANK_EXPR =
  `COALESCE((` +
  `SELECT MAX(CASE ${LEVEL_RANK_CASE_SQL} ELSE 0 END) ` +
  `FROM user_products up ` +
  `JOIN products p ON up.product_id = p.id ` +
  `WHERE up.user_id = users.id ` +
  `AND up.status = 'active' ` +
  `AND (up.expires_at IS NULL OR up.expires_at > NOW())` +
  `), -1)`;

// ---------------------------------------------------------------------------

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
    const alerts: {
      type: string;
      severity: string;
      title: string;
      description: string;
      link?: string;
      // Optional provenance for alerts whose thresholds are admin-tunable.
      // Today only `auth_rate_limit_burst` populates these; declared as
      // optional so future tunable alerts can opt in without widening
      // every other alert's payload.
      thresholds?: { threshold: number; windowMinutes: number };
      lastTuned?: {
        at: string;
        actorId: number | null;
        actorEmail: string | null;
        actorName: string | null;
        changedFields: string[];
      } | null;
    }[] = [];

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
      // Fetch the most recent threshold edit so the on-call admin can see
      // whether the alert fired against freshly-changed values without
      // having to leave the dashboard. Errors are swallowed: provenance is
      // a nice-to-have, never gate the alert itself on it.
      const lastTuned = await getLastAuthRateLimitAlertConfigEdit().catch(
        (err) => {
          console.error("[Admin] Auth rate-limit last-tuned lookup error:", err);
          return null;
        },
      );
      alerts.push({
        type: "auth_rate_limit_burst",
        severity: "high",
        title: "Auth rate-limit burst",
        description: `${stats.total} auth rate-limit hits in the last ${rateLimitWindowMinutes} minutes${ipSuffix}`,
        link: `/admin/audit-log?actionType=${AUTH_RATE_LIMIT_AUDIT_ACTION}`,
        // Live thresholds so the dashboard can render "tuned to N hits / M
        // min ..." without having to fetch the alert config itself.
        thresholds: {
          threshold: stats.threshold,
          windowMinutes: rateLimitWindowMinutes,
        },
        lastTuned,
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

// Parse a client-supplied audit-log date-range boundary into a Date, or null
// when the value is missing/invalid (so the filter is silently dropped rather
// than failing the whole request). The Audit Log page sends date-only values
// (`<input type="date">` → "YYYY-MM-DD"), so a naive `new Date("2026-06-12")`
// lands on UTC midnight. That's fine for the start boundary, but for the end
// boundary it would exclude the *entire* chosen day — a reviewer who sets the
// end date to the incident day would see none of that day's rows. To make the
// range inclusive of the end day we expand a bare date to 23:59:59.999 UTC.
// Values that already carry a time component (e.g. an ISO timestamp) are used
// verbatim for both boundaries.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseAuditDateBoundary(raw: string, boundary: "start" | "end"): Date | null {
  if (DATE_ONLY_RE.test(raw)) {
    const d = new Date(`${raw}T${boundary === "end" ? "23:59:59.999" : "00:00:00.000"}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

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

// The two action types written by the impersonation ("Log in as member")
// flow. Surfaced together under the synthetic "impersonation" filter value so
// compliance can pull every login-as-member event — start and stop — in one
// view rather than toggling between two dropdown entries.
const IMPERSONATION_ACTION_TYPES = ["impersonate_start", "impersonate_stop"] as const;

// Build the WHERE condition for the audit-log `actionType` filter. The
// synthetic value "impersonation" matches BOTH impersonate_start and
// impersonate_stop; every other value is an exact match on the stored
// action type.
function auditActionTypeCondition(actionType: string): SQL {
  if (actionType === "impersonation") {
    return inArray(auditLogTable.actionType, IMPERSONATION_ACTION_TYPES as unknown as string[]);
  }
  return eq(auditLogTable.actionType, actionType);
}

// Duration enrichment fields attached to impersonate_start rows so the UI can
// show how long a login-as-member session lasted without a second round-trip.
type ImpersonationDuration = {
  impersonationStoppedAt: string | null;
  impersonationDurationMs: number | null;
};

// Pair each impersonate_start row in `rows` with its matching impersonate_stop
// (same admin actor + same member entity, the earliest stop recorded after the
// start) and attach `impersonationStoppedAt` / `impersonationDurationMs`.
// Sessions that are still open — or whose stop row falls outside the data we're
// returning — get no fields and render as "ongoing / unknown" client-side.
// Only the start rows present on the current page are looked up (≤ page size),
// each via an index-backed LIMIT 1 probe, so this stays cheap on large logs.
// The fields are non-PII (durations only) and are added AFTER redaction, so
// they survive `sanitize` untouched.
async function attachImpersonationDurations<
  T extends {
    id: number;
    actionType: string | null;
    actorId: number | null;
    entityId: string | null;
    createdAt: Date | null;
  },
>(rows: T[]): Promise<(T & Partial<ImpersonationDuration>)[]> {
  const starts = rows.filter(
    (r) =>
      r.actionType === "impersonate_start" &&
      r.actorId != null &&
      r.entityId != null &&
      r.createdAt != null,
  );
  if (starts.length === 0) return rows;

  const durationByStartId = new Map<number, ImpersonationDuration>();
  await Promise.all(
    starts.map(async (s) => {
      const [stop] = await db
        .select({ createdAt: auditLogTable.createdAt })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.actionType, "impersonate_stop"),
            eq(auditLogTable.actorId, s.actorId as number),
            eq(auditLogTable.entityId, s.entityId as string),
            gt(auditLogTable.createdAt, s.createdAt as Date),
          ),
        )
        .orderBy(asc(auditLogTable.createdAt), asc(auditLogTable.id))
        .limit(1);
      if (stop?.createdAt) {
        durationByStartId.set(s.id, {
          impersonationStoppedAt: stop.createdAt.toISOString(),
          impersonationDurationMs:
            stop.createdAt.getTime() - (s.createdAt as Date).getTime(),
        });
      }
    }),
  );
  if (durationByStartId.size === 0) return rows;

  return rows.map((r) => {
    const d = durationByStartId.get(r.id);
    return d ? { ...r, ...d } : r;
  });
}

router.get("/admin/audit-log", requirePermission("audit:view"), async (req: Request, res: Response) => {
  try {
    const { actionType, entityType, actorId, startDate, endDate, outcome, page, limit = "50", expand, cursor, direction, jumpTo } = req.query;

    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));

    const conditions: any[] = [];
    if (actionType && typeof actionType === "string") conditions.push(auditActionTypeCondition(actionType));
    if (entityType && typeof entityType === "string") conditions.push(eq(auditLogTable.entityType, entityType));
    if (actorId && typeof actorId === "string") conditions.push(eq(auditLogTable.actorId, parseInt(actorId, 10)));
    if (startDate && typeof startDate === "string") {
      const start = parseAuditDateBoundary(startDate, "start");
      if (start) conditions.push(gte(auditLogTable.createdAt, start));
    }
    if (endDate && typeof endDate === "string") {
      const end = parseAuditDateBoundary(endDate, "end");
      if (end) conditions.push(lte(auditLogTable.createdAt, end));
    }
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
            logs: await attachImpersonationDurations(sanitize(logs)),
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
        logs: await attachImpersonationDurations(sanitize(window)),
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
          logs: await attachImpersonationDurations(sanitize(window)),
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
        logs: await attachImpersonationDurations(sanitize(window)),
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
        logs: await attachImpersonationDurations(sanitize(rows)),
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
      logs: await attachImpersonationDurations(sanitize(window)),
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
  if (actionType && typeof actionType === "string") conditions.push(auditActionTypeCondition(actionType));
  if (entityType && typeof entityType === "string") conditions.push(eq(auditLogTable.entityType, entityType));
  if (startDate && typeof startDate === "string") {
    const start = parseAuditDateBoundary(startDate, "start");
    if (start) conditions.push(gte(auditLogTable.createdAt, start));
  }
  if (endDate && typeof endDate === "string") {
    const end = parseAuditDateBoundary(endDate, "end");
    if (end) conditions.push(lte(auditLogTable.createdAt, end));
  }
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
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const [member] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    const [products, tickets, progress, notes, auditHistory, emailHistoryFull, emailAttemptRowsFull, phoneHistory, activeSessions] = await Promise.all([
      safeQuery(
        db.select({ id: userProductsTable.id, productId: userProductsTable.productId, status: userProductsTable.status, expiresAt: userProductsTable.expiresAt, createdAt: userProductsTable.createdAt, productName: productsTable.name, productSlug: productsTable.slug, externalOrderId: userProductsTable.externalOrderId, externalSource: userProductsTable.externalSource })
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
      // Currently-active sign-in sessions: not revoked and not past their
      // expiry. Most-recently-active first so the freshest device is on top.
      // Backs the "Active sessions" card on the Member Detail page.
      safeQuery(
        db.select({
          id: sessionsTable.id,
          createdAt: sessionsTable.createdAt,
          lastSeenAt: sessionsTable.lastSeenAt,
          expiresAt: sessionsTable.expiresAt,
          ipAddress: sessionsTable.ipAddress,
          userAgent: sessionsTable.userAgent,
        })
          .from(sessionsTable)
          .where(and(
            eq(sessionsTable.userId, id),
            isNull(sessionsTable.revokedAt),
            gt(sessionsTable.expiresAt, new Date()),
          ))
          .orderBy(desc(sessionsTable.lastSeenAt))
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
      activeSessions,
    });
  } catch (error) {
    console.error("[Admin] Member detail error:", error);
    res.status(500).json({ error: "Failed to fetch member details" });
  }
});

// Full impersonation ("Log in as member") history for a single member. Backs
// the dedicated "Impersonation" tab on the Member Detail page so compliance can
// see every staff login-as-member session for this specific person — which
// admin, when it started, when it stopped, and how long it lasted — without
// scanning the global audit log. Both impersonate_start and impersonate_stop
// rows are stored with entityType="user" + entityId=<member id>, so a single
// filtered query returns the whole session history. We pair them in memory
// (walking oldest→newest, each stop consumed once) to compute per-session
// durations, which is more accurate than the per-row heuristic the global
// audit-log listing uses because the full member-scoped timeline is in hand.
const MEMBER_IMPERSONATION_HISTORY_LIMIT = 200;
router.get("/admin/members/:id/impersonation-history", requirePermission("members:view"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const rows = await safeQuery(
      db.select()
        .from(auditLogTable)
        .where(and(
          eq(auditLogTable.entityType, "user"),
          eq(auditLogTable.entityId, String(id)),
          inArray(auditLogTable.actionType, IMPERSONATION_ACTION_TYPES as unknown as string[]),
        ))
        .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
        .limit(MEMBER_IMPERSONATION_HISTORY_LIMIT)
    );

    // Pair starts with stops to build discrete sessions. Walk oldest→newest so
    // each stop is matched to the most recent unpaired start by the same admin.
    // A stop with no preceding open start (e.g. its start predates the query
    // window) is still surfaced as a session with no start so the timeline is
    // complete. Sessions whose start has no stop render as "ongoing / unknown".
    const chronological = [...rows].reverse();
    type ImpersonationSession = {
      adminId: number | null;
      adminEmail: string | null;
      startId: number | null;
      startedAt: string | null;
      stopId: number | null;
      stoppedAt: string | null;
      durationMs: number | null;
    };
    const sessions: ImpersonationSession[] = [];
    const openByAdmin = new Map<number | string, ImpersonationSession>();
    for (const row of chronological) {
      const adminKey = row.actorId ?? "unknown";
      if (row.actionType === "impersonate_start") {
        const session: ImpersonationSession = {
          adminId: row.actorId ?? null,
          adminEmail: row.actorEmail ?? null,
          startId: row.id,
          startedAt: row.createdAt ? row.createdAt.toISOString() : null,
          stopId: null,
          stoppedAt: null,
          durationMs: null,
        };
        sessions.push(session);
        openByAdmin.set(adminKey, session);
      } else {
        // impersonate_stop
        const open = openByAdmin.get(adminKey);
        if (open && !open.stopId) {
          open.stopId = row.id;
          open.stoppedAt = row.createdAt ? row.createdAt.toISOString() : null;
          if (open.startedAt && open.stoppedAt) {
            open.durationMs = new Date(open.stoppedAt).getTime() - new Date(open.startedAt).getTime();
          }
          openByAdmin.delete(adminKey);
        } else {
          // A stop with no matching open start in this window.
          sessions.push({
            adminId: row.actorId ?? null,
            adminEmail: row.actorEmail ?? null,
            startId: null,
            startedAt: null,
            stopId: row.id,
            stoppedAt: row.createdAt ? row.createdAt.toISOString() : null,
            durationMs: null,
          });
        }
      }
    }
    // Newest session first to match the rest of the member detail page.
    sessions.reverse();

    res.json({
      sessions,
      total: sessions.length,
      limit: MEMBER_IMPERSONATION_HISTORY_LIMIT,
    });
  } catch (error) {
    console.error("[Admin] Member impersonation history error:", error);
    res.status(500).json({ error: "Failed to fetch impersonation history" });
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
    const rawId = getParam(req.params.id);
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
    const id = parseInt(getParam(req.params.id), 10);
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
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }
    const attemptId = parseInt(getParam(req.params.attemptId), 10);
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
    const id = parseInt(getParam(req.params.id), 10);
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
        tagline: productsTable.tagline,
        durationLabel: productsTable.durationLabel,
        highlights: productsTable.highlights,
        recommended: productsTable.recommended,
      })
      .from(productsTable)
      .orderBy(productsTable.sortOrder);
    res.json(products);
  } catch (error) {
    console.error("[Admin] List products error:", error);
    res.status(500).json({ error: "Failed to list products" });
  }
});

// PATCH /admin/products/:id — edit the plan presentation metadata (tagline,
// highlights bullets, "Most popular" recommended flag, durationLabel) that's
// rendered on the public /plans page. Only those four fields are editable
// here; the rest of the product row (slug, name, price, entitlements, etc.)
// is still managed elsewhere. Every changed field is sent through to the
// audit log so support staff can trace marketing-copy edits.
router.patch("/admin/products/:id", requirePermission("members:edit"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid product ID" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const update: {
      tagline?: string | null;
      durationLabel?: string | null;
      highlights?: string[];
      recommended?: boolean;
    } = {};
    const changedFields: string[] = [];

    if ("tagline" in body) {
      const v = body.tagline;
      if (v !== null && typeof v !== "string") {
        res.status(400).json({ error: "tagline must be a string or null" });
        return;
      }
      // Trim and treat empty strings as null so the column stays clean.
      const trimmed = typeof v === "string" ? v.trim() : null;
      update.tagline = trimmed && trimmed.length > 0 ? trimmed : null;
      changedFields.push("tagline");
    }

    if ("durationLabel" in body) {
      const v = body.durationLabel;
      if (v !== null && typeof v !== "string") {
        res.status(400).json({ error: "durationLabel must be a string or null" });
        return;
      }
      const trimmed = typeof v === "string" ? v.trim() : null;
      update.durationLabel = trimmed && trimmed.length > 0 ? trimmed : null;
      changedFields.push("durationLabel");
    }

    if ("highlights" in body) {
      const v = body.highlights;
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
        res.status(400).json({ error: "highlights must be an array of strings" });
        return;
      }
      // Strip blank entries so the bullet list stays tidy. We pass the array
      // through directly — Drizzle's jsonb binding stores it as a JSONB
      // array (the `products_highlights_is_array` CHECK rejects anything else).
      update.highlights = (v as string[])
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      changedFields.push("highlights");
    }

    if ("recommended" in body) {
      const v = body.recommended;
      if (typeof v !== "boolean") {
        res.status(400).json({ error: "recommended must be a boolean" });
        return;
      }
      update.recommended = v;
      changedFields.push("recommended");
    }

    if (changedFields.length === 0) {
      res.status(400).json({ error: "No editable fields supplied" });
      return;
    }

    const [updated] = await db
      .update(productsTable)
      .set(update)
      .where(eq(productsTable.id, id))
      .returning({
        id: productsTable.id,
        slug: productsTable.slug,
        name: productsTable.name,
        type: productsTable.type,
        durationDays: productsTable.durationDays,
        priceDisplay: productsTable.priceDisplay,
        sortOrder: productsTable.sortOrder,
        tagline: productsTable.tagline,
        durationLabel: productsTable.durationLabel,
        highlights: productsTable.highlights,
        recommended: productsTable.recommended,
      });

    if (!updated) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    await logAdminAction(
      req,
      "update_product_metadata",
      "product",
      String(id),
      `Updated plan metadata fields [${changedFields.join(", ")}] for product ${updated.slug}`,
    );

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Update product metadata error:", error);
    res.status(500).json({ error: "Failed to update product metadata" });
  }
});

router.post("/admin/members/:id/grant-product", requirePermission("members:edit"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
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
    const id = parseInt(getParam(req.params.id), 10);
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
    const id = parseInt(getParam(req.params.id), 10);
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
    // The verified-address notice's only CTA is the "Start a new email
    // change" button, which deep-links into this tenant's portal with a
    // signed prefill token. The portal base URL is sourced from per-tenant
    // configuration (system_settings → PORTAL_URL env → dev default) so
    // tenants on a custom domain don't ship members a link to someone
    // else's portal. If nothing is configured (production deployment with
    // no DB row and no env var) we deliberately skip this email rather
    // than send a useless / wrong-domain link — the dropped-pending-
    // address notice (further below) doesn't depend on the portal URL and
    // still goes out so somebody is informed.
    const portalUrl = await getPortalUrl();
    if (!portalUrl) {
      console.error(
        `[Admin] Skipping email_change_cancelled_by_admin notice for member ${id}: no portal URL configured (set ${PORTAL_URL_SETTING_KEY} in admin settings or PORTAL_URL env var)`,
      );
    } else {
      const prefillToken = signEmailChangePrefillToken({
        userId: id,
        prefillEmail: previousPendingEmail,
      });
      const restartUrl = buildEmailChangeRestartUrl(portalUrl, prefillToken);

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
    }

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

// Manually create a member from the admin panel. Used to onboard people who
// haven't signed up themselves (e.g. someone paid via an off-platform channel,
// or the public /register attempt never landed). Behavior:
//   - Validates email + name.
//   - Returns 409 if the email is already registered (admin needs to see this
//     — unlike the public /auth/register path, which is intentionally
//     non-enumerable for anonymous callers).
//   - Creates the user with a random, unguessable password (the admin never
//     sees it) and emailVerified=true (the admin is asserting they trust the
//     address). Clicking the password-reset link is what actually proves the
//     new member controls the inbox.
//   - Sends the standard `password_reset` email so the new member can set
//     their own password in one click — same template the forgot-password
//     flow uses, so no new template work.
//   - Writes an audit log entry tied to the actor admin.
router.post("/admin/members", requirePermission("members:edit"), async (req: Request, res: Response) => {
  try {
    const rawEmail = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const rawName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!rawEmail || !rawName) { res.status(400).json({ error: "Email and name are required" }); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(rawEmail)) { res.status(400).json({ error: "Invalid email format" }); return; }
    const email = rawEmail.toLowerCase();

    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (existing) { res.status(409).json({ error: "A member with that email already exists", id: existing.id }); return; }

    // Random password the admin never sees. The member sets their real password
    // via the password_reset email link below.
    const randomPassword = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(randomPassword, 12);
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

    let user;
    try {
      [user] = await db.insert(usersTable).values({
        name: rawName,
        email,
        passwordHash,
        emailVerified: true,
        resetToken: resetTokenHash,
        resetTokenExpires: resetExpires,
      }).returning({ id: usersTable.id, email: usersTable.email, name: usersTable.name });
    } catch (err) {
      // Race: someone else just inserted this email between our check and insert.
      const [raced] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);
      if (raced) { res.status(409).json({ error: "A member with that email already exists", id: raced.id }); return; }
      throw err;
    }

    // Intentionally do NOT log the raw email here — admin actor + new member id
    // are sufficient to correlate this row with the audit log entry below, and
    // the audit log carries the email under structured PII redaction.
    console.log(`[Admin] Created member id=${user.id} via admin panel`);
    await CommunicationService.sendEmailNow({
      templateSlug: "password_reset",
      to: email,
      variables: { member_name: rawName, reset_token: resetToken },
      userId: user.id,
    }).catch((err) =>
      console.error("[Admin] Failed to send password_reset email to new member:", err),
    );

    await logAdminAction(
      req,
      "create_member",
      "user",
      String(user.id),
      `Created member ${email} via admin panel (sent password_reset email)`,
      { after: { email, name: rawName, emailVerified: true } },
      { memberEmail: email },
    );

    res.status(201).json({ success: true, id: user.id, email: user.email, name: user.name });
  } catch (error) {
    console.error("[Admin] Create member error:", error);
    res.status(500).json({ error: "Failed to create member" });
  }
});

// Create a STAFF account (admin / support_agent / content_manager /
// compliance_reviewer / super_admin) straight from the admin panel — no more
// hand-editing the DB to onboard a teammate. Distinct from POST /admin/members
// (which creates a regular member and emails them a self-serve password link):
//   - Gated on `members:assign_role` (super_admin only) because picking the
//     role is itself a role-assignment super-power.
//   - The role MUST be one of the admin roles — this endpoint exists to mint
//     staff, not regular members (use POST /admin/members for those).
//   - Account is created ready-to-use: emailVerified=true AND
//     onboardingComplete=true, so the teammate skips the member onboarding
//     wizard and can sign straight into the admin panel.
//   - A human-shareable temporary password is generated and returned ONCE in
//     the response so the super_admin can hand it over out-of-band. We never
//     email it and never persist it in plaintext (only the bcrypt hash is
//     stored), so it is unrecoverable after this single response.
//   - Duplicate email returns 409 with a clear message (admins should see the
//     conflict, unlike the non-enumerable public /auth/register path).
router.post("/admin/staff", requirePermission("members:assign_role"), async (req: Request, res: Response) => {
  try {
    const rawEmail = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const rawName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const rawRole = typeof req.body?.role === "string" ? req.body.role.trim() : "";
    if (!rawEmail || !rawName) { res.status(400).json({ error: "Email and name are required" }); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(rawEmail)) { res.status(400).json({ error: "Invalid email format" }); return; }
    if (!isAdminRole(rawRole)) {
      res.status(400).json({
        error: `Invalid role. Staff accounts must use one of: ${ADMIN_ROLES.join(", ")}`,
      });
      return;
    }
    const email = rawEmail.toLowerCase();

    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (existing) { res.status(409).json({ error: "A member with that email already exists", id: existing.id }); return; }

    // Human-shareable temporary password. base64url avoids +/=/ characters
    // that get mangled when copy-pasted, while 18 random bytes (~24 chars)
    // keeps it well beyond brute-force range. The super_admin shares it
    // out-of-band; the staffer should change it after first sign-in.
    const temporaryPassword = crypto.randomBytes(18).toString("base64url");
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    let user;
    try {
      [user] = await db.insert(usersTable).values({
        name: rawName,
        email,
        passwordHash,
        role: rawRole,
        emailVerified: true,
        onboardingComplete: true,
        // Force a password change on first sign-in so the shared temporary
        // password is never the staffer's long-term credential.
        mustChangePassword: true,
      }).returning({ id: usersTable.id, email: usersTable.email, name: usersTable.name, role: usersTable.role });
    } catch (err) {
      // Race: someone else just inserted this email between our check and insert.
      const [raced] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);
      if (raced) { res.status(409).json({ error: "A member with that email already exists", id: raced.id }); return; }
      throw err;
    }

    console.log(`[Admin] Created staff account id=${user.id} role=${rawRole} via admin panel`);
    await logAdminAction(
      req,
      "create_staff",
      "user",
      String(user.id),
      `Created staff account ${email} with role ${rawRole} via admin panel`,
      { after: { email, name: rawName, role: rawRole, emailVerified: true, onboardingComplete: true } },
      { memberEmail: email },
    );

    // `temporaryPassword` is returned exactly once — it is not stored in
    // plaintext anywhere, so it cannot be re-fetched later.
    res.status(201).json({
      success: true,
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      temporaryPassword,
    });
  } catch (error) {
    console.error("[Admin] Create staff account error:", error);
    res.status(500).json({ error: "Failed to create staff account" });
  }
});

// Re-send the password-setup / password-reset email to an existing member.
// Useful when the original invite (from POST /admin/members) expired before
// the new member clicked it, or when a member is stuck and can't trigger
// /auth/forgot-password themselves (e.g. they don't remember their email,
// or rate limits are biting). Always mints a FRESH token — any previous
// reset token is invalidated — and uses the same `password_reset` template
// the public forgot-password flow uses.
router.post("/admin/members/:id/resend-invite", requirePermission("members:edit"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const [member] = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

    await db
      .update(usersTable)
      .set({ resetToken: resetTokenHash, resetTokenExpires: resetExpires })
      .where(eq(usersTable.id, id));

    console.log(`[Admin] Resent invite (password_reset) to member id=${id}`);
    await CommunicationService.sendEmailNow({
      templateSlug: "password_reset",
      to: member.email,
      variables: { member_name: member.name, reset_token: resetToken },
      userId: member.id,
    }).catch((err) =>
      console.error("[Admin] Failed to resend invite email:", err),
    );

    await logAdminAction(
      req,
      "resend_invite",
      "user",
      String(id),
      `Resent password-setup email to member ${member.email}`,
      undefined,
      { memberEmail: member.email },
    );

    res.json({ success: true, id });
  } catch (error) {
    console.error("[Admin] Resend invite error:", error);
    res.status(500).json({ error: "Failed to resend invite" });
  }
});

router.post("/admin/members/:id/force-verify", requirePermission("members:edit"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const [member] = await db
      .select({ id: usersTable.id, email: usersTable.email, emailVerified: usersTable.emailVerified })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    const wasVerified = member.emailVerified;

    // Always run the update (even when already verified) so the response is
    // idempotent and the audit trail records the admin's intent either way —
    // matching the /unlock pattern.
    await db
      .update(usersTable)
      .set({ emailVerified: true })
      .where(eq(usersTable.id, id));

    await logAdminAction(
      req,
      "force_verify_email",
      "user",
      String(id),
      `Force-verified email for member ${member.email} (bypassed email verification link)`,
      {
        before: { emailVerified: wasVerified },
        after: { emailVerified: true },
        memberEmail: member.email,
      },
    );

    res.json({ success: true, id, emailVerified: true, alreadyVerified: wasVerified });
  } catch (error) {
    console.error("[Admin] Force-verify email error:", error);
    res.status(500).json({ error: "Failed to force-verify email" });
  }
});

router.post("/admin/members/:id/unlock", requirePermission("members:edit"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
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

// Force an existing account to set a fresh password the next time they sign in
// by flipping the same `mustChangePassword` flag that POST /admin/staff sets on
// brand-new staff. Used after a temp password was shared out-of-band, or when an
// account may be compromised. The flag clears itself once the user completes the
// existing /change-password flow (see POST /members/me/password). RBAC + audit
// mirror POST /admin/staff (members:assign_role) since this is a sensitive
// credential-lifecycle action.
router.post("/admin/members/:id/force-password-reset", requirePermission("members:assign_role"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const [member] = await db
      .select({ id: usersTable.id, email: usersTable.email, mustChangePassword: usersTable.mustChangePassword })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    const wasSet = member.mustChangePassword;

    // Always run the update (even when already set) so the response is
    // idempotent and the audit trail records the admin's intent either way —
    // matching the /unlock and /force-verify patterns.
    await db
      .update(usersTable)
      .set({ mustChangePassword: true })
      .where(eq(usersTable.id, id));

    // Revoke the member's active sessions so an attacker with a live session is
    // bounced immediately rather than at their next /me re-fetch. The next
    // sign-in still routes them to /change-password via mustChangePassword.
    const revoked = await db
      .update(sessionsTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessionsTable.userId, id), isNull(sessionsTable.revokedAt)))
      .returning({ id: sessionsTable.id });
    const revokedCount = revoked.length;

    await logAdminAction(
      req,
      "force_password_reset",
      "user",
      String(id),
      `Forced password reset for member ${member.email} (they must set a new password on next sign-in; revoked ${revokedCount} active session${revokedCount === 1 ? "" : "s"})`,
      {
        before: { mustChangePassword: wasSet },
        after: { mustChangePassword: true },
        revokedSessionCount: revokedCount,
        // Surfaced so the audit-log redactor can scrub the email from the
        // description for viewers without `members:pii`.
        memberEmail: member.email,
      },
    );

    res.json({ success: true, id, mustChangePassword: true, alreadySet: wasSet, revokedSessionCount: revokedCount });
  } catch (error) {
    console.error("[Admin] Force password reset error:", error);
    res.status(500).json({ error: "Failed to force password reset" });
  }
});

// Revoke a single one of a member's active sign-in sessions. Finer-grained
// than force-password-reset (which revokes ALL sessions): lets an admin end
// one suspicious device without disturbing the member's other sessions or
// forcing a password change. RBAC + audit mirror force-password-reset
// (members:assign_role) since this is a sensitive credential-lifecycle action.
router.post("/admin/members/:id/sessions/:sessionId/revoke", requirePermission("members:assign_role"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }
    const sessionId = parseInt(getParam(req.params.sessionId), 10);
    if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid session ID" }); return; }

    const [member] = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    // Scope the lookup to this member so an admin can't revoke a session that
    // belongs to a different user by guessing IDs. Only act on a session that
    // is still active (not already revoked) so the response is meaningful.
    const [session] = await db
      .select({ id: sessionsTable.id, ipAddress: sessionsTable.ipAddress })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, id)))
      .limit(1);
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }

    const revoked = await db
      .update(sessionsTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, id), isNull(sessionsTable.revokedAt)))
      .returning({ id: sessionsTable.id });
    const wasActive = revoked.length > 0;

    if (wasActive) {
      await logAdminAction(
        req,
        "revoke_session",
        "user",
        String(id),
        `Revoked active sign-in session #${sessionId} for member ${member.email}`,
        {
          sessionId,
          sessionIp: session.ipAddress ?? null,
          // Surfaced so the audit-log redactor can scrub the email from the
          // description for viewers without `members:pii`.
          memberEmail: member.email,
        },
      );
    }

    res.json({ success: true, id, sessionId, revoked: wasActive });
  } catch (error) {
    console.error("[Admin] Revoke session error:", error);
    res.status(500).json({ error: "Failed to revoke session" });
  }
});

// Revoke ALL of a member's active sign-in sessions in one shot (without the
// password-change requirement that force-password-reset adds). Use when an
// account may be compromised but a forced password reset isn't wanted. RBAC +
// audit mirror force-password-reset (members:assign_role).
router.post("/admin/members/:id/sessions/revoke-all", requirePermission("members:assign_role"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const [member] = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    const revoked = await db
      .update(sessionsTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessionsTable.userId, id), isNull(sessionsTable.revokedAt)))
      .returning({ id: sessionsTable.id });
    const revokedCount = revoked.length;

    if (revokedCount > 0) {
      await logAdminAction(
        req,
        "revoke_all_sessions",
        "user",
        String(id),
        `Revoked all ${revokedCount} active sign-in session${revokedCount === 1 ? "" : "s"} for member ${member.email}`,
        {
          revokedSessionCount: revokedCount,
          // Surfaced so the audit-log redactor can scrub the email from the
          // description for viewers without `members:pii`.
          memberEmail: member.email,
        },
      );
    }

    res.json({ success: true, id, revokedSessionCount: revokedCount });
  } catch (error) {
    console.error("[Admin] Revoke all sessions error:", error);
    res.status(500).json({ error: "Failed to revoke sessions" });
  }
});

// Admin-initiated password-reset email. Unlike the self-serve forgot-password
// flow, this endpoint is authenticated (admin only), bypasses the public
// per-email/per-IP rate limit, and records an audit row so the action is
// visible in the member's history. The reset token + email are identical to
// what the self-serve flow sends, so the member follows the same link to
// set their new password and active sessions are revoked on completion.
router.post("/admin/members/:id/send-reset-email", requirePermission("members:assign_role"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const [member] = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

    await db
      .update(usersTable)
      .set({
        resetToken: resetTokenHash,
        resetTokenExpires: new Date(Date.now() + 60 * 60 * 1000),
      })
      .where(eq(usersTable.id, id));

    const emailResult = await CommunicationService.sendEmailNow({
      templateSlug: "password_reset",
      to: member.email,
      variables: { member_name: member.name ?? "", reset_token: resetToken },
      userId: member.id,
    });

    const emailSent = emailResult.status === "sent";
    const skipReason = emailResult.status === "skipped" ? emailResult.reason : null;
    const emailConfigured = skipReason === null || !skipReason.includes("provider_not_configured");
    const portalUrlMissing = skipReason === "portal_url_unconfigured";

    await logAdminAction(
      req,
      "send_password_reset_email",
      "user",
      String(id),
      `Sent password reset email for member ${member.email} (result: ${emailResult.status}${skipReason ? ` — ${skipReason}` : ""})`,
      {
        emailStatus: emailResult.status,
        emailConfigured,
        memberEmail: member.email,
      },
    );

    res.json({
      success: true,
      id,
      emailSent,
      emailConfigured,
      portalUrlMissing,
      emailStatus: emailResult.status,
    });
  } catch (error) {
    console.error("[Admin] Send password reset email error:", error);
    res.status(500).json({ error: "Failed to send password reset email" });
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
      const id = parseInt(getParam(req.params.id), 10);
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

// Stop must be registered BEFORE the /:id catch-all so Express does not
// match the literal string "stop" as a member id.
router.post("/admin/impersonate/stop", async (req: Request, res: Response) => {
  try {
    const restoreToken = req.cookies?.imp_restore_token;
    if (!restoreToken) {
      res.status(400).json({ error: "No active impersonation session" });
      return;
    }

    // Security: verify the current access token is an impersonation context.
    // Without this check a regular user who somehow obtains a stale
    // imp_restore_token (e.g. from a browser that wasn't fully logged out)
    // could call stop and be issued admin cookies.
    if (!req.isImpersonation) {
      res.status(403).json({ error: "Not in an active impersonation session" });
      return;
    }

    const restoreTokenHash = crypto.createHash("sha256").update(restoreToken).digest("hex");
    const [session] = await db
      .select({ id: sessionsTable.id, userId: sessionsTable.userId, expiresAt: sessionsTable.expiresAt, revokedAt: sessionsTable.revokedAt })
      .from(sessionsTable)
      .where(eq(sessionsTable.refreshTokenHash, restoreTokenHash))
      .limit(1);

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      res.clearCookie("imp_restore_token", { path: "/" });
      res.status(400).json({ error: "Impersonation restore token is invalid or expired" });
      return;
    }

    // Security: the restore session must belong to the admin who initiated
    // this impersonation. Prevents a user from using another admin's stale
    // restore token to escalate privileges.
    if (req.impersonatedBy !== session.userId) {
      res.clearCookie("imp_restore_token", { path: "/" });
      res.status(403).json({ error: "Restore token does not match impersonation context" });
      return;
    }

    const [adminUser] = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, session.userId))
      .limit(1);

    if (!adminUser) {
      res.status(404).json({ error: "Admin user not found" });
      return;
    }

    const COOKIE_BASE = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict" as const,
      path: "/",
    };

    if (!JWT_SECRET) {
      res.status(503).json({ error: "JWT_SECRET not configured" });
      return;
    }

    // Consume (single-use revoke) the restore session row so the token cannot
    // be replayed after a successful stop.
    await db.update(sessionsTable).set({ revokedAt: new Date() }).where(eq(sessionsTable.id, session.id));

    const newAccessToken = jwt.sign({ userId: adminUser.id, email: adminUser.email }, JWT_SECRET, { expiresIn: "15m" });
    res.cookie("access_token", newAccessToken, { ...COOKIE_BASE, maxAge: 15 * 60 * 1000 });
    // Restore session becomes the admin's new refresh token. The prior
    // admin refresh_token was cleared when impersonation started and the DB
    // row is now consumed/revoked above — so we issue a brand new session here.
    const newRefreshRaw = crypto.randomBytes(40).toString("hex");
    const newRefreshHash = crypto.createHash("sha256").update(newRefreshRaw).digest("hex");
    await db.insert(sessionsTable).values({
      userId: adminUser.id,
      refreshTokenHash: newRefreshHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
    });
    res.cookie("refresh_token", newRefreshRaw, {
      ...COOKIE_BASE,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/api/auth",
    });
    const csrfToken = crypto.randomBytes(32).toString("hex");
    res.cookie("csrf_token", csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict" as const,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.clearCookie("imp_restore_token", { path: "/" });

    // Log the stop action attributed to the restored admin user.
    // NOTE: We cannot spread `req` to override userId/userEmail because
    // Express Request properties like `headers` are non-enumerable and lost
    // during spread. Use logAuditEvent directly with explicit fields instead.
    const impersonatedUserId = req.userId;
    await logAuditEvent({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      actionType: "impersonate_stop",
      entityType: "user",
      entityId: impersonatedUserId ? String(impersonatedUserId) : "unknown",
      description: "Admin stopped impersonation",
      req,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Stop impersonation error:", error);
    res.status(500).json({ error: "Failed to stop impersonation" });
  }
});

router.post("/admin/impersonate/:id", requirePermission("members:impersonate"), async (req: Request, res: Response) => {
  try {
    if (!JWT_SECRET) { res.status(503).json({ error: "Impersonation unavailable — JWT_SECRET not configured" }); return; }

    const targetId = parseInt(getParam(req.params.id), 10);
    if (isNaN(targetId)) { res.status(400).json({ error: "Invalid member ID" }); return; }

    const [target] = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, targetId))
      .limit(1);
    if (!target) { res.status(404).json({ error: "Member not found" }); return; }

    // Prevent admins from impersonating other admin/super_admin accounts.
    if (target.role === "admin" || target.role === "super_admin") {
      res.status(403).json({ error: "Cannot impersonate admin or super_admin accounts" });
      return;
    }

    if (!req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    // Create a fresh DB-backed restore session for the admin.
    // We do NOT read req.cookies.refresh_token here — that cookie has
    // path="/api/auth" and browsers will not send it to /api/admin/* routes.
    // Instead we mint a new raw token, hash it, and store the row so the
    // stop endpoint has a verifiable, revokable credential to restore from.
    const restoreRaw = crypto.randomBytes(40).toString("hex");
    const restoreHash = crypto.createHash("sha256").update(restoreRaw).digest("hex");
    await db.insert(sessionsTable).values({
      userId: req.userId,
      refreshTokenHash: restoreHash,
      // Impersonation sessions last 30 minutes — match the access token TTL.
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
    });

    const impersonationToken = jwt.sign(
      { userId: target.id, email: target.email, impersonatedBy: req.userId, isImpersonation: true },
      JWT_SECRET,
      { expiresIn: "30m" },
    );

    const COOKIE_BASE = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict" as const,
      path: "/",
    };

    // Set the impersonation access token — replaces the admin's short-lived
    // access token for the duration of the session.
    res.cookie("access_token", impersonationToken, { ...COOKIE_BASE, maxAge: 30 * 60 * 1000 });

    // Store the raw restore token in a root-path cookie so the stop endpoint
    // (at /api/admin/impersonate/stop) can read it.
    res.cookie("imp_restore_token", restoreRaw, { ...COOKIE_BASE, maxAge: 30 * 60 * 1000 });

    // CRITICAL: clear the admin's normal refresh_token for the duration of
    // impersonation. Without this, when the 30-min impersonation access token
    // expires the browser's /api/auth-scoped refresh_token still works and
    // customFetch's 401-retry logic would silently swap back to the admin
    // session — making the admin believe they are still viewing as the member.
    // Clearing it here means expiry → /auth/refresh 401 → clean re-auth prompt.
    // The stop endpoint restores the admin's session from the restore DB row.
    res.clearCookie("refresh_token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict" as const,
      path: "/api/auth",
    });

    await logAdminAction(
      req,
      "impersonate_start",
      "user",
      String(targetId),
      `Admin started impersonating member ${target.name} (${target.email})`,
      {
        memberName: target.name,
        memberEmail: target.email,
      },
    );

    res.json({ member: { id: target.id, name: target.name, email: target.email } });
  } catch (error) {
    console.error("[Admin] Impersonation error:", error);
    res.status(500).json({ error: "Failed to start impersonation" });
  }
});

router.get("/admin/export/:type", requirePermission("export:data"), async (req: Request, res: Response) => {
  try {
    const type = getParam(req.params.type);
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
    // Per-tenant portal URL provenance. When production has neither a DB row
    // nor a PORTAL_URL env var, the resolver returns `null` and the
    // communication-service skips any template that renders {{portal_url}}
    // (password resets, verifications) so members don't click a broken
    // `/reset-password?token=...` link. Surface that state on the System
    // Health page so on-call notices before members do.
    const portalUrlStatus = await getPortalUrlStatus();
    const portalUrl = {
      configured: portalUrlStatus.portalUrl !== null,
      source: portalUrlStatus.source,
      // True only in production when nothing is configured. The dev default
      // is fine outside production, so we don't want to nag local devs.
      productionFallbackMissing:
        process.env.NODE_ENV === "production" && portalUrlStatus.portalUrl === null,
      settingKey: PORTAL_URL_SETTING_KEY,
    };
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
    // Snapshot the moderation-job failure tracker for the System Health
    // card. We grab the in-window stats at the same threshold/window the
    // alerter is configured with so the page mirrors what's actually
    // gating the page. Loading the config can throw if the DB flaps —
    // fall back to defaults (15m window) so the panel still renders.
    let moderationFailureWindowMinutes = 15;
    try {
      const cfg = await getModerationFailureAlertConfigStatus();
      moderationFailureWindowMinutes = cfg.config.windowMinutes;
    } catch (err) {
      console.error("[Admin] system/health: failed to read moderation failure config:", err);
    }
    const moderationFailures = {
      window: await getModerationFailuresInWindowAggregated(
        moderationFailureWindowMinutes * 60 * 1000,
      ),
      cumulative: getModerationFailureCumulativeStats(),
      alerter: getModerationFailureAlertingState(),
    };

    // Snapshot the scheduled-comms dedup-store failure tracker. When the
    // comms_send_log dedup store is broken, the scheduler SKIPS sends to avoid
    // double-sends, silently suppressing mentorship-expiry / feedback /
    // announcement emails. Mirror the moderation card: read the in-window
    // count at the same window the alerter pages on so the page matches what's
    // actually paging on-call. The tracker is in-memory + synchronous, so
    // this can't throw on a DB flap.
    const commsDedupFailureWindowMs = parseInt(
      process.env.COMMS_DEDUP_FAILURE_ALERT_WINDOW_MS ?? "",
      10,
    );
    const commsDedupFailures = {
      window: getCommsDedupFailuresInWindow(
        Number.isFinite(commsDedupFailureWindowMs) && commsDedupFailureWindowMs > 0
          ? commsDedupFailureWindowMs
          : 15 * 60 * 1000,
      ),
      cumulative: getCommsDedupFailureCumulativeStats(),
      alerter: getCommsDedupFailureAlertingState(),
    };

    // Snapshot the stuck-ticket delivery backlog for the System Health card.
    // Counts tickets stuck undelivered (pending/failed) past the configured
    // age. The alerter state mirrors what's actually paging on-call so the
    // page and the page-on-call never disagree. A DB error here degrades to a
    // zeroed snapshot so the rest of the panel still renders.
    let ticketDeskDelivery: {
      stuck: Awaited<ReturnType<typeof getStuckTicketDeliveryStats>>;
      alerter: ReturnType<typeof getTicketDeskDeliveryAlertingState>;
    };
    try {
      ticketDeskDelivery = {
        stuck: await getStuckTicketDeliveryStats(),
        alerter: getTicketDeskDeliveryAlertingState(),
      };
    } catch (err) {
      console.error("[Admin] system/health: failed to read ticketdesk delivery stats:", err);
      ticketDeskDelivery = {
        stuck: {
          count: 0,
          byStatus: { pending: 0, failed: 0 },
          oldestCreatedAt: null,
          lastError: null,
          stuckMinutes: 30,
        },
        alerter: getTicketDeskDeliveryAlertingState(),
      };
    }

    // Active probe of the embedded Live Chat (TicketDesk). If that URL starts
    // sending framing-blocking headers (X-Frame-Options / CSP frame-ancestors)
    // the in-portal iframe silently breaks and members get bounced to a new
    // tab by the 8s client-side watchdog. Surface the probe state and flip the
    // banner to degraded the moment the embed is blocked.
    const liveChatEmbed = getLiveChatEmbedProbeState();

    // Active probe of the programmatic ticket-delivery origin gate. If the
    // portal domain is dropped from TicketDesk's allowed-origins list, every
    // support ticket silently fails to deliver (403 "Origin not allowed") and
    // retries forever. Surface the probe state and flip the banner to degraded
    // the moment delivery is blocked — distinct from the widget-embed probe.
    const ticketDeskDeliveryGate = getTicketDeskDeliveryProbeState();

    // Interpret the cached Retell voice-agent setup result. A silent regression
    // (RETELL_AGENT_ID repointed to an agent that is NOT on the KB-connected
    // retell-llm engine) lands the cached setup in a skipped/error state; the
    // interpreter flags that as "misconfigured" so on-call sees a warning
    // instead of the voice assistant quietly answering wrong/empty. We only
    // flip the banner to degraded when it's configured-but-broken
    // (needsAttention) — "not_configured" (voice intentionally off, normal in
    // dev) and "unknown" (still initializing) must not nag.
    const retellSetup = getCachedRetellSetupResult();
    const voiceAgentHealth = interpretRetellSetupHealth(retellSetup);
    const voiceAgentAlerting = getRetellAgentAlertingState();
    const voiceAgent = {
      status: voiceAgentHealth.status,
      needsAttention: voiceAgentHealth.needsAttention,
      detail: voiceAgentHealth.detail,
      // True when the on-call alerter is currently paging for this broken
      // agent — lets the System Health card render "currently paging on-call"
      // without re-deriving the transition logic.
      alerting: voiceAgentAlerting.alerting,
      agentResponseEngineType: retellSetup?.agentResponseEngineType ?? null,
      requiresAgentIdUpdate: retellSetup?.requiresAgentIdUpdate ?? false,
      newAgentId: retellSetup?.newAgentId ?? null,
      ranAt: retellSetup?.ranAt ?? null,
    };

    const overallStatus = !dbOk || queueFallbacks.alerting || !redisConnected || rateLimitAuditFailures.totalCount > 0 || portalUrl.productionFallbackMissing || moderationFailures.window.totalCount > 0 || commsDedupFailures.window.totalCount > 0 || liveChatEmbed.status === "blocked" || liveChatEmbed.alerting || ticketDeskDelivery.alerter.alerting || ticketDeskDeliveryGate.status === "blocked" || ticketDeskDeliveryGate.alerting || voiceAgent.needsAttention
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

    // Per-template heartbeat for the recurring coaching-call auto top-up
    // job. Lets admins confirm each series is being extended and spot one
    // that stopped (lastError set). Only templates the job has actually
    // swept appear here.
    const coachingCallTemplateTopUp = {
      templates: getCoachingCallTemplateTopUpStatus(),
      health: getCoachingCallTemplateTopUpHealth(),
    };

    res.json({
      status: overallStatus,
      services: {
        api: { status: "up", uptime: process.uptime() },
        database: { status: dbOk ? "up" : "down", totalUsers: userCount, totalTickets: ticketCount },
        redis: { status: redisStatus, queueFallbacks },
        signupChallenge: { enforced: isSignupChallengeEnforced() },
        abuseRateLimitCleanup: await getAbuseRateLimitCleanupStatus(),
        upgradePromptEventsCleanup: getUpgradePromptEventsCleanupStatus(),
        emailChangeAttemptsRetention: getEmailChangeAttemptsRetentionPolicy(),
        emailChangeAttemptsCleanup: getEmailChangeAttemptsCleanupStatus(),
        auditLogRetention,
        coachingCallTemplateTopUp,
        machineMismatchDigest: getMachineMismatchDigestStatus(),
        machineMismatchDigestWatchdog: await getMachineMismatchDigestWatchdogState(),
        rateLimitAuditFailures,
        moderationFailures,
        commsDedupFailures,
        ticketDeskDelivery,
        liveChatEmbed,
        ticketDeskDeliveryGate,
        voiceAgent,
        missingCriticalSecrets,
        portalUrl,
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
 * On-demand live re-check of the Retell voice-agent health.
 *
 * The voiceAgent block in `/admin/system/health` reads the RetellSetup result
 * cached at server boot. If the agent breaks (or is fixed) after startup, that
 * verdict goes stale until the next restart. This endpoint runs a READ-ONLY
 * probe (`probeRetellAgentHealth` — retrieve only, no agent/LLM mutation),
 * refreshes the shared cache, and returns the freshly-interpreted verdict in
 * the SAME shape as the health endpoint's `voiceAgent` field so the System
 * Health card can update in place. Gated on `system:view` to match the health
 * endpoint (the probe makes no changes).
 */
router.post(
  "/admin/system/voice-agent/recheck",
  requirePermission("system:view"),
  async (_req: Request, res: Response) => {
    try {
      const result = await probeRetellAgentHealth();
      setCachedRetellSetupResult(result);
      const verdict = interpretRetellSetupHealth(result);
      res.json({
        voiceAgent: {
          status: verdict.status,
          needsAttention: verdict.needsAttention,
          detail: verdict.detail,
          agentResponseEngineType: result.agentResponseEngineType ?? null,
          requiresAgentIdUpdate: result.requiresAgentIdUpdate ?? false,
          newAgentId: result.newAgentId ?? null,
          ranAt: result.ranAt,
        },
      });
    } catch (error) {
      console.error("[Admin] Voice-agent re-check error:", error);
      res.status(500).json({ error: "Failed to re-check voice agent health" });
    }
  },
);

/**
 * Resolved live-chat (TicketDesk) support destination.
 *
 * The same support URL is consumed in two independent runtimes: the portal
 * embed (Vite, `VITE_TICKETDESK_URL`) and the backend health probe (Node,
 * `LIVE_CHAT_EMBED_PROBE_URL`), each falling back to the shared default in
 * `@workspace/support-config`. This endpoint surfaces the backend-resolved
 * probe URL (and the shared default) so the admin Settings page can show the
 * live destination and confirm the probe and embed agree — without an admin
 * having to read code or env vars. Gated on `settings:view` so Settings
 * admins (who may lack `system:view`) can still see it.
 */
router.get(
  "/admin/system/live-chat-support",
  requirePermission("settings:view"),
  (_req: Request, res: Response) => {
    const probeUrl = getLiveChatEmbedProbeUrl();
    const probeUrlSource =
      process.env.LIVE_CHAT_EMBED_PROBE_URL &&
      process.env.LIVE_CHAT_EMBED_PROBE_URL.trim().length > 0
        ? "env"
        : "default";
    res.json({
      probeUrl,
      probeUrlSource,
      defaultUrl: DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL,
    });
  },
);

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

    // Include every alerter that writes audit rows with entityType="alert"
    // so the System Health timeline answers "did *any* on-call page go
    // out?" — not just queue-fallback ones. Today that's queue-fallback +
    // machine-order-mismatch (task #494) + the machine-mismatch daily-digest
    // heartbeat watchdog; future alerters add their action-type constant here
    // without any UI changes.
    const TIMELINE_ALERT_ACTION_TYPES = [
      QUEUE_FALLBACK_ALERT_ACTION_TYPE,
      MACHINE_MISMATCH_ALERT_ACTION_TYPE,
      MACHINE_MISMATCH_DIGEST_ALERT_ACTION_TYPE,
      RETELL_AGENT_ALERT_ACTION_TYPE,
    ];

    const baseFilter = and(
      inArray(auditLogTable.actionType, TIMELINE_ALERT_ACTION_TYPES),
      eq(auditLogTable.entityType, QUEUE_FALLBACK_ALERT_ENTITY_TYPE),
    );

    const rowConditions = [
      inArray(auditLogTable.actionType, TIMELINE_ALERT_ACTION_TYPES),
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
          actionType: auditLogTable.actionType,
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
        // Which alerter wrote this row, so the timeline can label the source
        // (queue-fallback / Machine mismatch / voice assistant / …) and deep
        // link each entry to the right detail (the voice-assistant rows link
        // to the Voice Assistant panel; the rest to their audit-log filter).
        actionType: row.actionType,
        queueChannel,
        deliveryChannel,
        kind,
        outcome,
        reason,
        description: row.description,
        // Raw metadata payload so the System Health admin can inline-inspect
        // a flagged delivery (full reason text, recent/hour/day counts,
        // delivery-channel-specific identifiers like a PagerDuty incident
        // key, etc.) without leaving the on-call workflow. The metadata
        // column is already free-form JSON; we forward the entire object so
        // future fields written by the alerter automatically show up in the
        // expanded row without a coordinating frontend change.
        metadata: meta,
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

    // Surface the background-moderation failure alerter in the bell so an
    // admin sees "moderation jobs are failing" without first opening
    // System Health. Mirrors the rate-limit-audit-failure block above.
    // The kick on every notifications poll also doubles as a backstop for
    // the in-process poll interval — if the interval ever stalls, the
    // bell's 60s refresh still drives the evaluator forward.
    const moderationFailureAlerting = getModerationFailureAlertingState();
    const moderationCumulative = getModerationFailureCumulativeStats();
    if (moderationFailureAlerting.alerting) {
      notifications.push({
        id: "moderation-failure",
        type: "moderation_failure",
        severity: "high",
        title: "Background moderation jobs are failing",
        message: `${moderationFailureAlerting.lastSeenWindowTotal} failure(s) inside the rolling window — flagged content may be slipping through or staying publicly active. ${moderationCumulative.byKind.persist} persist failure(s) since process start.`,
        link: "/admin/system",
        createdAt: moderationFailureAlerting.lastInWindowFailureAt ?? moderationCumulative.lastAt ?? new Date().toISOString(),
      });
    }
    evaluateModerationFailureAlert().catch((err) => {
      console.error("[Admin] moderation-failure alerter dispatch failed:", err);
    });

    // Surface the scheduled-comms dedup-store failure alerter in the bell so
    // an admin sees "scheduled emails are being suppressed" without first
    // opening System Health. Mirrors the moderation-failure block above. The
    // kick on every notifications poll backstops the alerter's in-process poll
    // and the end-of-scheduler-run evaluation.
    const commsDedupFailureAlerting = getCommsDedupFailureAlertingState();
    const commsDedupFailureCumulative = getCommsDedupFailureCumulativeStats();
    if (commsDedupFailureAlerting.alerting) {
      notifications.push({
        id: "comms-dedup-failure",
        type: "comms_dedup_failure",
        severity: "high",
        title: "Scheduled emails are being silently suppressed",
        message: `${commsDedupFailureAlerting.lastSeenWindowTotal} dedup-store failure(s) inside the rolling window — the comms_send_log store is broken, so the scheduler is skipping mentorship-expiry / feedback / announcement sends. ${commsDedupFailureCumulative.totalCount} failure(s) since process start.`,
        link: "/admin/system",
        createdAt: commsDedupFailureAlerting.lastInWindowFailureAt ?? commsDedupFailureCumulative.lastAt ?? new Date().toISOString(),
      });
    }
    evaluateCommsDedupFailureAlert().catch((err) => {
      console.error("[Admin] comms dedup-failure alerter dispatch failed:", err);
    });
    // Surface the pod-silence watchdog in the bell so an admin sees that a
    // moderation pod has gone quiet (and may have stopped moderating) without
    // first opening System Health. Reads the alerter's current state, which is
    // driven forward by the evaluation kicked off below (and by the in-process
    // poll). Mirrors the moderation-failure block above.
    const podSilentAlerting = getModerationPodSilentAlertingState();
    if (podSilentAlerting.alertingPodIds.length > 0) {
      const ids = podSilentAlerting.alertingPodIds;
      const count = ids.length;
      notifications.push({
        id: "moderation-pod-silent",
        type: "moderation_pod_silent",
        severity: "high",
        title:
          count === 1
            ? "A moderation pod has gone silent"
            : `${count} moderation pods have gone silent`,
        message: `${count === 1 ? "Pod" : "Pods"} ${ids.join(", ")} stopped reporting moderation activity for over 2× the rolling window — flag-worthy posts may be staying publicly live with nobody watching.`,
        link: "/admin/system",
        createdAt: new Date().toISOString(),
      });
    }
    // Same backstop for the pod-silence watchdog: page on-call automatically
    // when a previously-reporting moderation pod goes quiet past the staleness
    // threshold, even if the in-process poll interval has stalled.
    evaluateModerationPodSilentAlert().catch((err) => {
      console.error("[Admin] moderation pod-silent alerter dispatch failed:", err);
    });

    // Surface the TicketDesk delivery alerter in the bell so an admin sees
    // that ticket delivery is backing up without first opening System Health.
    // Mirrors the moderation-failure block above; the kick below also doubles
    // as a backstop for the in-process poll interval.
    const ticketDeskDeliveryAlerting = getTicketDeskDeliveryAlertingState();
    if (ticketDeskDeliveryAlerting.alerting) {
      const downForClause = ticketDeskDeliveryAlerting.outageAge
        ? ` (delivery has been down for ${ticketDeskDeliveryAlerting.outageAge})`
        : "";
      notifications.push({
        id: "ticketdesk-delivery-backlog",
        type: "ticketdesk_delivery_backlog",
        severity: "high",
        title: ticketDeskDeliveryAlerting.escalated
          ? `TicketDesk ticket delivery has been down for ${ticketDeskDeliveryAlerting.outageAge}`
          : "TicketDesk ticket delivery is failing",
        message: `${ticketDeskDeliveryAlerting.lastSeenCount} support ticket(s) are stuck undelivered to TicketDesk${downForClause} — the origin whitelist may have expired, the secret rotated, or TicketDesk may be down. Members will start emailing directly.`,
        link: "/admin/system",
        createdAt: new Date().toISOString(),
      });
    }
    evaluateTicketDeskDeliveryAlert().catch((err) => {
      console.error("[Admin] ticketdesk-delivery alerter dispatch failed:", err);
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
        !isMachineMismatchAlertSettingKey(s.key) &&
        !isChangeHistoryRetentionSettingKey(s.key) &&
        !isPortalUrlSettingKey(s.key) &&
        !isAiModerationThresholdSettingKey(s.key),
    );
    res.json(filtered);
  } catch (error) {
    console.error("[Admin] Settings error:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/admin/settings/:key", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const key = getParam(req.params.key);
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
    if (isMachineMismatchAlertSettingKey(key)) {
      res.status(400).json({ error: "Use /admin/machine-mismatch-alert-config to manage Machine order mismatch alert thresholds" });
      return;
    }
    if (isModerationFailureAlertSettingKey(key)) {
      res.status(400).json({ error: "Use /admin/moderation-failure-alert-config to manage moderation failure alert thresholds" });
      return;
    }
    if (isChangeHistoryRetentionSettingKey(key)) {
      res.status(400).json({ error: "Use /admin/change-history-retention-config to manage change-history retention windows" });
      return;
    }
    if (isPortalUrlSettingKey(key)) {
      // The dedicated endpoint validates the URL (must be http/https,
      // must include a host, no `javascript:`/`data:` payloads). Routing
      // updates through it keeps that validation in one place.
      res.status(400).json({ error: "Use /admin/portal-url to manage the per-tenant portal URL" });
      return;
    }
    if (isAiModerationThresholdSettingKey(key)) {
      res.status(400).json({ error: "Use /admin/ai-moderation-threshold-config to manage the AI moderation flag threshold" });
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
      const field = getParam(req.params.field);
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
 * Read the current Machine order mismatch alert thresholds plus their
 * defaults and accepted bounds. Mirrors the auth rate-limit endpoint
 * above so the Settings UI can reuse the same patterns (per-field
 * provenance, reset to defaults, bounds-driven input validation).
 */
router.get("/admin/machine-mismatch-alert-config", requirePermission("settings:view"), async (_req: Request, res: Response) => {
  try {
    const status = await getMachineMismatchAlertConfigStatus();
    res.json(status);
  } catch (error) {
    console.error("[Admin] Get machine mismatch alert config error:", error);
    res.status(500).json({ error: "Failed to fetch machine mismatch alert config" });
  }
});

/**
 * Update one or more of the Machine order mismatch alert thresholds. Body
 * is a partial — any field omitted is left untouched, and a `null` value
 * resets that field back to its shipped default. Out-of-bounds values are
 * rejected 400 with `fieldErrors` so the UI can surface them inline.
 * Successful saves write an audit-log row tagged
 * `entityType=machine_mismatch_alert_config` with the per-field diff so
 * admins can answer "who tuned this to N?" later.
 */
router.put("/admin/machine-mismatch-alert-config", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const validation = validateMachineMismatchAlertUpdate(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: "Invalid alert config", fieldErrors: validation.errors });
      return;
    }
    const { before, after, changedFields } = await applyMachineMismatchAlertConfigUpdate(
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
        "machine_mismatch_alert_config",
        "machine_mismatch_alert",
        `Updated machine mismatch alert config: ${changedFields.join(", ")}`,
        { changedFields, diff },
      );
    }
    const status = await getMachineMismatchAlertConfigStatus();
    res.json({ ...status, changedFields });
  } catch (error) {
    console.error("[Admin] Update machine mismatch alert config error:", error);
    res.status(500).json({ error: "Failed to update machine mismatch alert config" });
  }
});

router.get(
  "/admin/machine-mismatch-digest-alert-config",
  requirePermission("settings:view"),
  async (_req: Request, res: Response) => {
    try {
      const status = await getDigestAlerterTuningStatus();
      res.json(status);
    } catch (error) {
      console.error("[Admin] Get machine mismatch digest alert config error:", error);
      res.status(500).json({ error: "Failed to fetch machine mismatch digest alert config" });
    }
  },
);

/**
 * Update the Machine order mismatch *digest watchdog* sensitivity knobs:
 * the staleness threshold multiplier and the re-page throttle. Body is a
 * partial — omit a field to leave it untouched; a `null` resets that field
 * to its env/default. Out-of-bounds values are rejected 400 with
 * `fieldErrors` so the UI can surface them inline. Successful saves write an
 * audit-log row tagged `entityType=machine_mismatch_digest_alert_config`
 * with the per-field diff.
 */
router.put(
  "/admin/machine-mismatch-digest-alert-config",
  requirePermission("settings:manage"),
  async (req: Request, res: Response) => {
    try {
      const validation = validateDigestAlerterTuningUpdate(req.body);
      if (!validation.ok) {
        res.status(400).json({ error: "Invalid digest alert config", fieldErrors: validation.errors });
        return;
      }
      const { before, after, changedFields } = await applyDigestAlerterTuningUpdate(
        validation.update,
        req.userEmail || (req.userId ? String(req.userId) : null),
      );
      if (changedFields.length > 0) {
        const diff: Record<string, { from: number; to: number }> = {};
        for (const field of changedFields as DigestAlerterTuningField[]) {
          diff[field] = { from: before[field], to: after[field] };
        }
        await logAdminAction(
          req,
          "update_setting",
          "machine_mismatch_digest_alert_config",
          "oncall",
          `Updated machine mismatch digest alert config: ${changedFields.join(", ")}`,
          { changedFields, diff },
        );
      }
      const status = await getDigestAlerterTuningStatus();
      res.json({ ...status, changedFields });
    } catch (error) {
      console.error("[Admin] Update machine mismatch digest alert config error:", error);
      res.status(500).json({ error: "Failed to update machine mismatch digest alert config" });
    }
  },
);

/**
 * Live read of the digest watchdog's current state for the Settings card so
 * on-call can confirm a sensitivity change had the intended effect without
 * waiting for a page. Returns the same snapshot the System Health page uses
 * (`getMachineMismatchDigestWatchdogState`), which reuses the exact
 * `evaluateDigestHealth` decision the alerter acts on — so the displayed
 * state always matches what the watchdog would do.
 */
router.get(
  "/admin/machine-mismatch-digest-watchdog-state",
  requirePermission("settings:view"),
  async (_req: Request, res: Response) => {
    try {
      const state = await getMachineMismatchDigestWatchdogState();
      res.json(state);
    } catch (error) {
      console.error("[Admin] Get machine mismatch digest watchdog state error:", error);
      res.status(500).json({ error: "Failed to fetch machine mismatch digest watchdog state" });
    }
  },
);

// Audit-log entityType / actionType / allowed-fields for the burst-alert
// threshold edits, kept next to the route that filters on them so the
// dashboard alert and the Settings card stay in sync if the writer ever
// changes its tags.
const AUTH_RATE_LIMIT_ALERT_CONFIG_ENTITY_TYPE = "auth_rate_limit_alert_config";
const AUTH_RATE_LIMIT_ALERT_CONFIG_ACTION_TYPE = "update_setting";
type AuthRateLimitAlertConfigField = "threshold" | "windowMinutes" | "dominantIpRatio";
const AUTH_RATE_LIMIT_ALERT_CONFIG_FIELDS: AuthRateLimitAlertConfigField[] = [
  "threshold",
  "windowMinutes",
  "dominantIpRatio",
];

interface AuthRateLimitAlertConfigDiffEntry {
  field: AuthRateLimitAlertConfigField;
  from: number | null;
  to: number | null;
}

interface AuthRateLimitAlertConfigEditEvent {
  id: number;
  createdAt: Date;
  actionType: string;
  actorId: number | null;
  actorEmail: string | null;
  actorName: string | null;
  description: string;
  changedFields: AuthRateLimitAlertConfigField[];
  diff: AuthRateLimitAlertConfigDiffEntry[];
}

/**
 * Narrow an audit row's `changeDiff` JSON down to the typed shape the UI
 * knows how to render. The writer puts touched fields in `changedFields`
 * and a per-field `{ from, to }` map in `diff`; both are filtered here so
 * a future schema change can't sneak an unexpected key into the response.
 */
function parseAuthRateLimitAlertConfigDiff(raw: unknown): {
  changedFields: AuthRateLimitAlertConfigField[];
  diff: AuthRateLimitAlertConfigDiffEntry[];
} {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const changedRaw = Array.isArray(obj.changedFields) ? obj.changedFields : [];
  const changedFields = changedRaw.filter(
    (f): f is AuthRateLimitAlertConfigField =>
      typeof f === "string" && (AUTH_RATE_LIMIT_ALERT_CONFIG_FIELDS as string[]).includes(f),
  );
  const diffMap = (obj.diff ?? {}) as Record<string, unknown>;
  const diff: AuthRateLimitAlertConfigDiffEntry[] = [];
  for (const field of changedFields) {
    const entry = diffMap[field];
    if (!entry || typeof entry !== "object") {
      diff.push({ field, from: null, to: null });
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const from = typeof rec.from === "number" && Number.isFinite(rec.from) ? rec.from : null;
    const to = typeof rec.to === "number" && Number.isFinite(rec.to) ? rec.to : null;
    diff.push({ field, from, to });
  }
  return { changedFields, diff };
}

/**
 * Look up the most recent auth-rate-limit alert config edit so the dashboard
 * can render "tuned to N hits / M min by <admin> on <date>" inline on the
 * burst alert card. Returns `null` when no edits have happened yet (the
 * thresholds are still on defaults), or on lookup failure — provenance is
 * informational and must not gate the alert itself.
 */
async function getLastAuthRateLimitAlertConfigEdit(): Promise<{
  at: string;
  actorId: number | null;
  actorEmail: string | null;
  actorName: string | null;
  changedFields: AuthRateLimitAlertConfigField[];
} | null> {
  const rows = await db
    .select({
      id: auditLogTable.id,
      createdAt: auditLogTable.createdAt,
      actorId: auditLogTable.actorId,
      actorEmail: auditLogTable.actorEmail,
      actorName: usersTable.name,
      changeDiff: auditLogTable.changeDiff,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(auditLogTable.actorId, usersTable.id))
    .where(
      and(
        eq(auditLogTable.entityType, AUTH_RATE_LIMIT_ALERT_CONFIG_ENTITY_TYPE),
        eq(auditLogTable.actionType, AUTH_RATE_LIMIT_ALERT_CONFIG_ACTION_TYPE),
      ),
    )
    .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const { changedFields } = parseAuthRateLimitAlertConfigDiff(row.changeDiff);
  return {
    at: row.createdAt.toISOString(),
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    actorName: row.actorName,
    changedFields,
  };
}

/**
 * Recent change history for the auth rate-limit burst alert thresholds. Mirrors
 * the on-call destinations history endpoint above — both let the matching
 * Settings card render a small "who changed what" timeline so an on-call admin
 * can see threshold provenance without leaving the page.
 *
 * Filters audit_log down to `entityType = "auth_rate_limit_alert_config"`
 * rows, which today is just `update_setting` writes from the PUT endpoint
 * above. The change diff carries `{ changedFields, diff: { field: { from, to } } }`
 * — both are narrowed defensively against a future schema drift.
 *
 * Query params:
 *   - limit: number of events to return (default 10, max 50). Tuned small by
 *     default because the card just needs the "last few changes" — admins
 *     who want the full history can drill into the dedicated Audit Log page.
 */
router.get("/admin/auth-rate-limit-alert-config/history", requirePermission("settings:view"), async (req: Request, res: Response) => {
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
          eq(auditLogTable.entityType, AUTH_RATE_LIMIT_ALERT_CONFIG_ENTITY_TYPE),
          eq(auditLogTable.actionType, AUTH_RATE_LIMIT_ALERT_CONFIG_ACTION_TYPE),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
      .limit(limit);

    const events: AuthRateLimitAlertConfigEditEvent[] = rows.map((row) => {
      const { changedFields, diff } = parseAuthRateLimitAlertConfigDiff(row.changeDiff);
      return {
        id: row.id,
        createdAt: row.createdAt,
        actionType: row.actionType,
        actorId: row.actorId,
        actorEmail: row.actorEmail,
        actorName: row.actorName,
        description: row.description,
        changedFields,
        diff,
      };
    });

    res.json({ events, limit });
  } catch (error) {
    console.error("[Admin] Auth rate-limit alert config history error:", error);
    res.status(500).json({ error: "Failed to fetch auth rate-limit alert config history" });
  }
});

/**
 * Returns a recent-traffic snapshot the admin Settings card uses to show
 * "would have fired N times in the last D days" for the saved (or in-progress)
 * thresholds. The response includes per-day totals (always accurate) and,
 * when the volume is small enough, the raw event timestamps so the UI can
 * recompute the "would have fired" count locally for any draft threshold
 * without a network round trip. See
 * `auth-rate-limit-alert-traffic-preview.ts` for cost guards.
 */
// Audit-log entityType / actionType tags for moderation-failure threshold
// edits — kept next to the history route below and reused by the PUT
// handler so the dashboard's "recent threshold edits" timeline stays in
// sync with the writer.
const MODERATION_FAILURE_ALERT_CONFIG_ENTITY_TYPE = "moderation_failure_alert_config";
const MODERATION_FAILURE_ALERT_CONFIG_ACTION_TYPE = "update_setting";
type ModerationFailureAlertConfigField = "threshold" | "windowMinutes";
const MODERATION_FAILURE_ALERT_CONFIG_FIELDS: ModerationFailureAlertConfigField[] = [
  "threshold",
  "windowMinutes",
];

interface ModerationFailureAlertConfigDiffEntry {
  field: ModerationFailureAlertConfigField;
  from: number | null;
  to: number | null;
}

function parseModerationFailureAlertConfigDiff(raw: unknown): {
  changedFields: ModerationFailureAlertConfigField[];
  diff: ModerationFailureAlertConfigDiffEntry[];
} {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const changedRaw = Array.isArray(obj.changedFields) ? obj.changedFields : [];
  const changedFields = changedRaw.filter(
    (f): f is ModerationFailureAlertConfigField =>
      typeof f === "string" && (MODERATION_FAILURE_ALERT_CONFIG_FIELDS as string[]).includes(f),
  );
  const diffMap = (obj.diff ?? {}) as Record<string, unknown>;
  const diff: ModerationFailureAlertConfigDiffEntry[] = [];
  for (const field of changedFields) {
    const entry = diffMap[field];
    if (!entry || typeof entry !== "object") {
      diff.push({ field, from: null, to: null });
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const from = typeof rec.from === "number" && Number.isFinite(rec.from) ? rec.from : null;
    const to = typeof rec.to === "number" && Number.isFinite(rec.to) ? rec.to : null;
    diff.push({ field, from, to });
  }
  return { changedFields, diff };
}

/**
 * Read the current moderation-failure alert thresholds plus defaults +
 * bounds. Mirrors the auth-rate-limit endpoint above so the Settings UI
 * can reuse the same alert-config card / history components.
 */
router.get("/admin/moderation-failure-alert-config", requirePermission("settings:view"), async (_req: Request, res: Response) => {
  try {
    const status = await getModerationFailureAlertConfigStatus();
    res.json(status);
  } catch (error) {
    console.error("[Admin] Get moderation failure alert config error:", error);
    res.status(500).json({ error: "Failed to fetch moderation failure alert config" });
  }
});

/**
 * Update one or more moderation-failure alert thresholds. Partial body —
 * `null` for a field resets it back to default. Validation errors come
 * back per-field so the Settings card can render them inline.
 */
router.put("/admin/moderation-failure-alert-config", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const validation = validateModerationFailureAlertUpdate(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: "Invalid alert config", fieldErrors: validation.errors });
      return;
    }
    const { before, after, changedFields } = await applyModerationFailureAlertConfigUpdate(
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
        MODERATION_FAILURE_ALERT_CONFIG_ACTION_TYPE,
        MODERATION_FAILURE_ALERT_CONFIG_ENTITY_TYPE,
        "moderation_failure_alert",
        `Updated moderation failure alert config: ${changedFields.join(", ")}`,
        { changedFields, diff },
      );
    }
    const status = await getModerationFailureAlertConfigStatus();
    res.json({ ...status, changedFields });
  } catch (error) {
    console.error("[Admin] Update moderation failure alert config error:", error);
    res.status(500).json({ error: "Failed to update moderation failure alert config" });
  }
});

/**
 * Read the current AI moderation flag threshold plus default + bounds.
 * Bounds are returned alongside the value so the admin Settings card can
 * mirror the server's validation without hard-coding it.
 */
router.get("/admin/ai-moderation-threshold-config", requirePermission("settings:view"), async (_req: Request, res: Response) => {
  try {
    const status = await getAiModerationThresholdConfigStatus();
    res.json(status);
  } catch (error) {
    console.error("[Admin] Get AI moderation threshold config error:", error);
    res.status(500).json({ error: "Failed to fetch AI moderation threshold config" });
  }
});

/**
 * "What-if" preview for a proposed AI moderation flag threshold. Returns
 * how many recent moderation_queue rows would have been flagged by the AI
 * classifier at the proposed value vs the currently-saved one, so the
 * Settings UI can warn admins before they apply an extreme value.
 */
router.get("/admin/ai-moderation-threshold-config/preview", requirePermission("settings:view"), async (req: Request, res: Response) => {
  try {
    const raw = req.query.threshold;
    const parsed = Number(raw);
    const { min, max } = AI_MODERATION_THRESHOLD_BOUNDS.flagThreshold;
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      res.status(400).json({ error: `threshold must be a number between ${min} and ${max}` });
      return;
    }
    const preview = await computeAiThresholdPreview(parsed);
    res.json(preview);
  } catch (error) {
    console.error("[Admin] Preview AI moderation threshold error:", error);
    res.status(500).json({ error: "Failed to compute AI moderation threshold preview" });
  }
});

/**
 * Update the AI moderation flag threshold. Body is `{ flagThreshold }`
 * (number in 0..1, or `null` to reset to the shipped default). Successful
 * changes write an audit row with the before/after values and invalidate
 * the in-process cache so the engine picks the new threshold up on the
 * very next evaluate() call.
 */
router.put("/admin/ai-moderation-threshold-config", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const validation = validateAiModerationThresholdUpdate(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: "Invalid AI moderation threshold config", fieldErrors: validation.errors });
      return;
    }
    const { before, after, changedFields } = await applyAiModerationThresholdConfigUpdate(
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
        "ai_moderation_threshold_config",
        "ai_moderation_threshold",
        `Updated AI moderation threshold: ${changedFields.join(", ")}`,
        { changedFields, diff },
      );
    }
    const status = await getAiModerationThresholdConfigStatus();
    res.json({ ...status, changedFields });
  } catch (error) {
    console.error("[Admin] Update AI moderation threshold config error:", error);
    res.status(500).json({ error: "Failed to update AI moderation threshold config" });
  }
});

/**
 * Recent change history for the moderation-failure alert thresholds.
 * Mirrors the auth-rate-limit history endpoint shape so the Settings UI
 * can render the same "who tuned what" timeline.
 */
router.get("/admin/moderation-failure-alert-config/history", requirePermission("settings:view"), async (req: Request, res: Response) => {
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
          eq(auditLogTable.entityType, MODERATION_FAILURE_ALERT_CONFIG_ENTITY_TYPE),
          eq(auditLogTable.actionType, MODERATION_FAILURE_ALERT_CONFIG_ACTION_TYPE),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
      .limit(limit);

    const events = rows.map((row) => {
      const { changedFields, diff } = parseModerationFailureAlertConfigDiff(row.changeDiff);
      return {
        id: row.id,
        createdAt: row.createdAt,
        actionType: row.actionType,
        actorId: row.actorId,
        actorEmail: row.actorEmail,
        actorName: row.actorName,
        description: row.description,
        changedFields,
        diff,
      };
    });
    res.json({ events, limit });
  } catch (error) {
    console.error("[Admin] Moderation failure alert config history error:", error);
    res.status(500).json({ error: "Failed to fetch moderation failure alert config history" });
  }
});

router.get(
  "/admin/auth-rate-limit-alert-config/traffic-preview",
  requirePermission("settings:view"),
  async (req: Request, res: Response) => {
    try {
      const lookbackDays = coerceAlertTrafficPreviewLookbackDays(req.query.lookbackDays);
      const preview = await getAuthRateLimitAlertTrafficPreview({ lookbackDays });
      res.json(preview);
    } catch (error) {
      console.error("[Admin] Get auth rate-limit alert traffic preview error:", error);
      res.status(500).json({ error: "Failed to fetch auth rate-limit alert traffic preview" });
    }
  },
);

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
 * Read the per-tenant portal base URL plus its provenance ("db" / "env" /
 * "dev_default" / null when nothing is configured). The branded-link emails
 * (e.g. the admin-cancellation "Start a new email change" CTA) use this
 * value to build absolute URLs that point at THIS tenant's portal — not a
 * shared `buildtestscale.com` fallback.
 */
router.get("/admin/portal-url", requirePermission("settings:view"), async (_req: Request, res: Response) => {
  try {
    const status = await getPortalUrlStatus();
    res.json(status);
  } catch (error) {
    console.error("[Admin] Get portal URL error:", error);
    res.status(500).json({ error: "Failed to fetch portal URL" });
  }
});

/**
 * Save (or clear) the per-tenant portal base URL. Body shape:
 *   - `{ "portalUrl": "https://portal.acme.example" }` to save a value
 *   - `{ "portalUrl": null }` (or `""`) to delete the row so the read path
 *     falls back to the env var / dev default
 *
 * The URL is validated server-side: it must be an absolute http/https URL
 * with a host. Invalid input returns 400 with a per-field error so the UI
 * can show it next to the input.
 *
 * Saves are recorded in the audit log with the previous and new value plus
 * provenance, so an admin can see which tenant override was changed and
 * when. The portal URL is not a secret, so the value itself appears in the
 * audit row (matching the generic settings endpoint's behavior).
 */
router.put("/admin/portal-url", requirePermission("settings:manage"), async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(body, "portalUrl")) {
      res.status(400).json({ error: "portalUrl is required" });
      return;
    }
    const raw = body.portalUrl;
    let next: string | null;
    if (raw === null) {
      next = null;
    } else if (typeof raw === "string") {
      next = raw.trim() === "" ? null : raw;
    } else {
      res.status(400).json({ error: "portalUrl must be a string or null" });
      return;
    }

    const before = await getPortalUrlStatus();
    const result = await setPortalUrl(
      next,
      req.userEmail || (req.userId ? String(req.userId) : null),
    );
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const after = await getPortalUrlStatus();

    // Only audit when the resolved value actually changed — clearing an
    // already-empty row, or saving the same URL twice, is a no-op for the
    // read path and shouldn't churn the audit log.
    if (before.portalUrl !== after.portalUrl || before.source !== after.source) {
      await logAdminAction(
        req,
        "update_setting",
        "portal_url",
        PORTAL_URL_SETTING_KEY,
        next === null
          ? "Cleared per-tenant portal URL override"
          : `Updated per-tenant portal URL to ${after.portalUrl}`,
        {
          before: { portalUrl: before.portalUrl, source: before.source },
          after: { portalUrl: after.portalUrl, source: after.source },
        },
      );
    }

    res.json(after);
  } catch (error) {
    console.error("[Admin] Update portal URL error:", error);
    res.status(500).json({ error: "Failed to update portal URL" });
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
    const { page = "1", limit = "20", search, role, externalSource, externalOrderId, sortBy, sortDir } = req.query;
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

    // Filter by where the member's access came from. `externalSource`
    // accepts either a specific source value (e.g. "yse"), the special
    // "direct" sentinel (members who have NO user_products row with an
    // external_source — i.e. signed up directly), or "any"/missing for
    // no filter. `externalOrderId` matches members who have at least
    // one user_products row whose external_order_id matches (case
    // insensitive). Both filters use EXISTS / NOT EXISTS subqueries to
    // keep the user row count stable (a join would multiply duplicates
    // when a member owns several products from the same source).
    const externalSourceStr =
      typeof externalSource === "string" ? externalSource.trim() : "";
    const externalOrderIdStr =
      typeof externalOrderId === "string" ? externalOrderId.trim() : "";

    if (externalSourceStr && externalSourceStr.toLowerCase() !== "any") {
      if (externalSourceStr.toLowerCase() === "direct") {
        conditions.push(sql`NOT EXISTS (
          SELECT 1 FROM ${userProductsTable}
          WHERE ${userProductsTable.userId} = ${usersTable.id}
            AND ${userProductsTable.externalSource} IS NOT NULL
        )`);
      } else {
        conditions.push(sql`EXISTS (
          SELECT 1 FROM ${userProductsTable}
          WHERE ${userProductsTable.userId} = ${usersTable.id}
            AND ${userProductsTable.externalSource} = ${externalSourceStr}
        )`);
      }
    }

    if (externalOrderIdStr) {
      const pattern = `%${externalOrderIdStr}%`;
      conditions.push(sql`EXISTS (
        SELECT 1 FROM ${userProductsTable}
        WHERE ${userProductsTable.userId} = ${usersTable.id}
          AND ${userProductsTable.externalOrderId} ILIKE ${pattern}
      )`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // ---------------------------------------------------------------------------
    // Sort — allowlist both column and direction so params can't inject SQL.
    // Unknown/missing sortBy falls back to createdAt DESC (existing default).
    // ---------------------------------------------------------------------------
    const sortByStr = typeof sortBy === "string" ? sortBy : "";
    const safeDir = typeof sortDir === "string" && sortDir.toLowerCase() === "asc" ? "ASC" : "DESC";

    // Columns that can be referenced directly through Drizzle table identifiers.
    const SORT_COL_EXPRS: Record<string, string> = {
      name: "users.name",
      email: "users.email",
      role: "users.role",
      joined: "users.member_since",
    };

    let orderExpr: SQL;
    if (sortByStr === "level") {
      orderExpr = sql.raw(`${LEVEL_RANK_EXPR} ${safeDir}`);
    } else if (sortByStr in SORT_COL_EXPRS) {
      orderExpr = sql.raw(`${SORT_COL_EXPRS[sortByStr]} ${safeDir}`);
    } else {
      orderExpr = desc(usersTable.createdAt);
    }
    // ---------------------------------------------------------------------------

    const [rawMembers, countResult] = await Promise.all([
      db.select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        sourceProduct: usersTable.sourceProduct,
        memberSince: usersTable.memberSince,
        lastLoginAt: usersTable.lastLoginAt,
        createdAt: usersTable.createdAt,
        levelRank: sql<number>`${sql.raw(LEVEL_RANK_EXPR)}`,
      })
        .from(usersTable)
        .where(whereClause)
        .orderBy(orderExpr)
        .limit(limitNum)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(usersTable).where(whereClause),
    ]);

    const members = rawMembers.map((m) => ({
      ...m,
      levelLabel: getProductLabelByRank(m.levelRank),
    }));

    res.json({
      members,
      pagination: { page: pageNum, limit: limitNum, total: Number(countResult[0]?.count || 0), totalPages: Math.ceil(Number(countResult[0]?.count || 0) / limitNum) },
    });
  } catch (error) {
    console.error("[Admin] Members list error:", error);
    res.status(500).json({ error: "Failed to fetch members" });
  }
});

// Distinct `external_source` values currently present on `user_products`.
// Used to populate the source-filter dropdown on the admin members list
// without hard-coding the integration set in the frontend — when a new
// integration starts grant-importing rows, it shows up automatically.
router.get(
  "/admin/members/external-sources",
  requirePermission("members:view"),
  async (_req: Request, res: Response) => {
    try {
      const rows = await db
        .selectDistinct({ externalSource: userProductsTable.externalSource })
        .from(userProductsTable)
        .where(isNotNull(userProductsTable.externalSource));
      const sources = rows
        .map((r) => r.externalSource)
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .sort();
      res.json({ sources });
    } catch (error) {
      console.error("[Admin] External sources list error:", error);
      res.status(500).json({ error: "Failed to fetch external sources" });
    }
  },
);

// ─── External-integration order history ──────────────────────────────────────
// Lists grants that came in through the external grant-product endpoint,
// grouped per (externalSource, externalOrderId, userId) so a single order
// that provisioned multiple products renders as one row with all product
// names. Defaults to externalSource = "yse" for backwards compatibility, but
// accepts a `source` query param (single value, comma-separated list, or the
// special value "any") so the same view powers YSE, Machine (getthemachine.com),
// and any future integration sources. The Machine integration also stores the
// originating `tap_ref` as `metadata.bts_ref` and the funnel as
// `metadata.funnel_slug` on the webhook_logs payload — both are surfaced
// alongside each order so staff can attribute / filter by affiliate code.
const KNOWN_EXTERNAL_SOURCES = ["yse", "machine"] as const;

// `parsePortalProductKeys` and `computeOrderMismatch` live in
// `../lib/external-order-mismatch` so the background mismatch alerter can
// reuse them without dragging in this whole route module at startup. See
// the lib file for the heuristic.

function parseSourceParam(source: unknown): string[] {
  if (typeof source !== "string") return ["yse"];
  const trimmed = source.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "yse") return ["yse"];
  if (trimmed.toLowerCase() === "any" || trimmed.toLowerCase() === "all") {
    return [...KNOWN_EXTERNAL_SOURCES];
  }
  const parts = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : ["yse"];
}

router.get(
  "/admin/integrations/yse/orders",
  requirePermission("members:view"),
  async (req: Request, res: Response) => {
    try {
      const {
        page = "1",
        limit = "20",
        search,
        source = "yse",
        btsRef,
      } = req.query;
      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const limitNum = Math.min(
        100,
        Math.max(1, parseInt(limit as string, 10) || 20),
      );
      const offset = (pageNum - 1) * limitNum;

      const sources = parseSourceParam(source);
      const btsRefStr =
        typeof btsRef === "string" && btsRef.trim() !== ""
          ? btsRef.trim()
          : null;

      const conditions: SQL[] = [
        sources.length === 1
          ? eq(userProductsTable.externalSource, sources[0])
          : inArray(userProductsTable.externalSource, sources),
        isNotNull(userProductsTable.externalOrderId),
      ];

      if (search && typeof search === "string" && search.trim() !== "") {
        const term = `%${search.trim()}%`;
        conditions.push(
          or(
            ilike(userProductsTable.externalOrderId, term),
            ilike(usersTable.email, term),
          )!,
        );
      }

      // bts_ref / funnel_slug live on the webhook_logs payload (json),
      // keyed by external_id = `${externalSource}_${externalOrderId}`.
      // Left-join so YSE rows (which don't always have a webhook_logs row
      // for the same external_id pattern) still render.
      const webhookExternalId = sql<string>`${userProductsTable.externalSource} || '_' || ${userProductsTable.externalOrderId}`;
      const btsRefExpr = sql<string | null>`max(${webhookLogsTable.payload} -> 'metadata' ->> 'bts_ref')`;
      const funnelSlugExpr = sql<string | null>`max(${webhookLogsTable.payload} -> 'metadata' ->> 'funnel_slug')`;
      // PostgreSQL has no max() aggregate over jsonb, so we cast to text and
      // JSON.parse on the JS side. All rows in a (userId, externalOrderId)
      // group join to the same webhook_logs row, so the aggregate is just
      // picking the single value that's there.
      const portalProductKeysExpr = sql<string | null>`max((${webhookLogsTable.payload} -> 'metadata' -> 'portal_product_keys')::text)`;

      if (btsRefStr) {
        conditions.push(
          sql`${webhookLogsTable.payload} -> 'metadata' ->> 'bts_ref' = ${btsRefStr}`,
        );
      }

      const whereClause = and(...conditions);

      const grantedAtExpr = sql<Date>`min(${userProductsTable.purchasedAt})`;

      // One row per (externalOrderId, userId): aggregate product names and
      // take the earliest purchasedAt as the order's granted-at timestamp.
      // "wasNewUser" is true when the user was provisioned by this same
      // import — i.e. their account was created within a small window of the
      // grant and their sourceProduct matches the external source.
      const rowsPromise = db
        .select({
          externalOrderId: userProductsTable.externalOrderId,
          externalSource: userProductsTable.externalSource,
          userId: usersTable.id,
          userEmail: usersTable.email,
          userName: usersTable.name,
          userSourceProduct: usersTable.sourceProduct,
          userCreatedAt: usersTable.createdAt,
          grantedAt: grantedAtExpr,
          // Aggregate each granted product as a {name, slug} JSON object
          // so the pair always stays together — earlier versions used two
          // separate array_aggs with different ORDER BYs, which could zip
          // a slug onto the wrong name when alphabetical order diverged.
          products: sql<Array<{ name: string; slug: string }>>`json_agg(distinct jsonb_build_object('name', ${productsTable.name}, 'slug', ${productsTable.slug}))`,
          productCount: sql<number>`count(distinct ${productsTable.id})`,
          btsRef: btsRefExpr,
          funnelSlug: funnelSlugExpr,
          portalProductKeys: portalProductKeysExpr,
        })
        .from(userProductsTable)
        .innerJoin(usersTable, eq(userProductsTable.userId, usersTable.id))
        .innerJoin(
          productsTable,
          eq(userProductsTable.productId, productsTable.id),
        )
        .leftJoin(
          webhookLogsTable,
          eq(webhookLogsTable.externalId, webhookExternalId),
        )
        .where(whereClause)
        .groupBy(
          userProductsTable.externalOrderId,
          userProductsTable.externalSource,
          usersTable.id,
          usersTable.email,
          usersTable.name,
          usersTable.sourceProduct,
          usersTable.createdAt,
        )
        .orderBy(desc(grantedAtExpr))
        .limit(limitNum)
        .offset(offset);

      const countPromise = db
        .select({
          count: sql<number>`count(*)`,
        })
        .from(
          db
            .selectDistinct({
              externalOrderId: userProductsTable.externalOrderId,
              userId: userProductsTable.userId,
            })
            .from(userProductsTable)
            .innerJoin(
              usersTable,
              eq(userProductsTable.userId, usersTable.id),
            )
            .leftJoin(
              webhookLogsTable,
              eq(webhookLogsTable.externalId, webhookExternalId),
            )
            .where(whereClause)
            .as("distinct_orders"),
        );

      const [rows, countResult] = await Promise.all([rowsPromise, countPromise]);

      const orders = rows.map((r) => {
        const grantedAt = r.grantedAt ? new Date(r.grantedAt) : null;
        const userCreatedAt = r.userCreatedAt
          ? new Date(r.userCreatedAt)
          : null;
        // 60-second window: the external-grant handler creates the user and
        // inserts the grants inside the same transaction, so a "new user"
        // order has user.createdAt essentially equal to the grant's
        // purchasedAt. Anything older means the user already existed.
        const wasNewUser =
          !!grantedAt &&
          !!userCreatedAt &&
          r.userSourceProduct === r.externalSource &&
          Math.abs(grantedAt.getTime() - userCreatedAt.getTime()) <= 60_000;

        const products = Array.isArray(r.products) ? r.products : [];
        const portalProductKeys = parsePortalProductKeys(r.portalProductKeys);
        const mismatch = computeOrderMismatch(
          r.externalSource!,
          products.map((p) => p.slug),
          portalProductKeys,
        );

        return {
          externalOrderId: r.externalOrderId,
          externalSource: r.externalSource,
          userId: r.userId,
          userEmail: r.userEmail,
          userName: r.userName,
          grantedAt: grantedAt ? grantedAt.toISOString() : null,
          products,
          productCount: Number(r.productCount || 0),
          wasNewUser,
          btsRef: r.btsRef ?? null,
          funnelSlug: r.funnelSlug ?? null,
          portalProductKeys,
          mismatch,
        };
      });

      const total = Number(countResult[0]?.count || 0);

      // Page-scoped mismatch summary — counts only the rows in this page's
      // slice, so the "N of M Machine orders…" line in the UI matches what
      // the admin is currently looking at.
      const machineOrders = orders.filter((o) => o.externalSource === "machine");
      const mismatchSummary = {
        machineOrdersInView: machineOrders.length,
        machineOrdersWithMismatch: machineOrders.filter((o) => o.mismatch)
          .length,
      };

      res.json({
        orders,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
        mismatchSummary,
      });
    } catch (error) {
      console.error("[Admin] External orders list error:", error);
      res.status(500).json({ error: "Failed to fetch external orders" });
    }
  },
);

// CSV export for the YSE order history page. Emits one row per
// (order, product) — i.e. the grouped table on /admin/integrations/yse
// is "unwrapped" so reconciliation against YSE's own records is a
// straight row-for-row diff. Honours the same `search` and `source`
// filters as the read endpoint above. We do NOT page or hard-cap here:
// the underlying table is bounded by real YSE order volume and admins
// pulling for reconciliation expect the full slice.
router.get(
  "/admin/integrations/yse/orders/export",
  requirePermission("members:view"),
  async (req: Request, res: Response) => {
    try {
      const { search, source = "yse", btsRef } = req.query;

      const sources = parseSourceParam(source);
      const btsRefStr =
        typeof btsRef === "string" && btsRef.trim() !== ""
          ? btsRef.trim()
          : null;

      const conditions: SQL[] = [
        sources.length === 1
          ? eq(userProductsTable.externalSource, sources[0])
          : inArray(userProductsTable.externalSource, sources),
        isNotNull(userProductsTable.externalOrderId),
      ];

      if (search && typeof search === "string" && search.trim() !== "") {
        const term = `%${search.trim()}%`;
        conditions.push(
          or(
            ilike(userProductsTable.externalOrderId, term),
            ilike(usersTable.email, term),
          )!,
        );
      }

      if (btsRefStr) {
        conditions.push(
          sql`${webhookLogsTable.payload} -> 'metadata' ->> 'bts_ref' = ${btsRefStr}`,
        );
      }

      const whereClause = and(...conditions);

      // One row per (order, product). Mirrors the read endpoint's
      // "was new user" rule (user.sourceProduct matches the external
      // source and the grant landed within ~60s of account creation)
      // so the CSV row's `was_new_user` column lines up with what the
      // admin saw in the UI before clicking Export.
      const webhookExternalId = sql<string>`${userProductsTable.externalSource} || '_' || ${userProductsTable.externalOrderId}`;
      const rows = await db
        .select({
          externalOrderId: userProductsTable.externalOrderId,
          externalSource: userProductsTable.externalSource,
          userEmail: usersTable.email,
          userSourceProduct: usersTable.sourceProduct,
          userCreatedAt: usersTable.createdAt,
          purchasedAt: userProductsTable.purchasedAt,
          productSlug: productsTable.slug,
          productName: productsTable.name,
          btsRef: sql<string | null>`${webhookLogsTable.payload} -> 'metadata' ->> 'bts_ref'`,
          funnelSlug: sql<string | null>`${webhookLogsTable.payload} -> 'metadata' ->> 'funnel_slug'`,
          portalProductKeys: sql<string[] | null>`${webhookLogsTable.payload} -> 'metadata' -> 'portal_product_keys'`,
        })
        .from(userProductsTable)
        .innerJoin(usersTable, eq(userProductsTable.userId, usersTable.id))
        .innerJoin(
          productsTable,
          eq(userProductsTable.productId, productsTable.id),
        )
        .leftJoin(
          webhookLogsTable,
          eq(webhookLogsTable.externalId, webhookExternalId),
        )
        .where(whereClause)
        .orderBy(
          desc(userProductsTable.purchasedAt),
          asc(productsTable.name),
        );

      const filenameSource = sources.length === 1 ? sources[0] : "external";
      await logAdminAction(
        req,
        "export_data",
        "external_orders",
        undefined,
        `Exported ${rows.length} ${filenameSource} order/product rows`,
      );

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=${filenameSource}-orders-export.csv`,
      );
      res.write(
        "order_id,source,customer_email,product_slug,product_name,granted_at,was_new_user,bts_ref,funnel_slug,portal_product_keys,mismatch\n",
      );

      // Pre-compute the mismatch flag once per (source, orderId, email)
      // group — the CSV unwraps to one row per (order, product), but the
      // mismatch is a property of the order as a whole, so we have to
      // aggregate the granted slugs across all rows in the group first.
      const groupKey = (r: (typeof rows)[number]) =>
        `${r.externalSource ?? ""}|${r.externalOrderId ?? ""}|${r.userEmail ?? ""}`;
      const slugsByGroup = new Map<string, string[]>();
      for (const r of rows) {
        const key = groupKey(r);
        const list = slugsByGroup.get(key) ?? [];
        if (r.productSlug) list.push(r.productSlug);
        slugsByGroup.set(key, list);
      }
      const mismatchByGroup = new Map<string, boolean>();
      for (const r of rows) {
        const key = groupKey(r);
        if (mismatchByGroup.has(key)) continue;
        const portalProductKeys = parsePortalProductKeys(r.portalProductKeys);
        mismatchByGroup.set(
          key,
          computeOrderMismatch(
            r.externalSource ?? "",
            slugsByGroup.get(key) ?? [],
            portalProductKeys,
          ),
        );
      }

      for (const r of rows) {
        const grantedAt = r.purchasedAt ? new Date(r.purchasedAt) : null;
        const userCreatedAt = r.userCreatedAt
          ? new Date(r.userCreatedAt)
          : null;
        const wasNewUser =
          !!grantedAt &&
          !!userCreatedAt &&
          r.userSourceProduct === r.externalSource &&
          Math.abs(grantedAt.getTime() - userCreatedAt.getTime()) <= 60_000;

        const mismatch = mismatchByGroup.get(groupKey(r)) ?? false;

        res.write(
          [
            r.externalOrderId ?? "",
            r.externalSource ?? "",
            r.userEmail ?? "",
            r.productSlug ?? "",
            r.productName ?? "",
            grantedAt ? grantedAt.toISOString() : "",
            wasNewUser ? "true" : "false",
            r.btsRef ?? "",
            r.funnelSlug ?? "",
            Array.isArray(r.portalProductKeys)
              ? JSON.stringify(r.portalProductKeys)
              : "",
            mismatch ? "true" : "false",
          ]
            .map(csvEscape)
            .join(",") + "\n",
        );
      }

      res.end();
    } catch (error) {
      console.error("[Admin] External orders export error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to export external orders" });
      } else {
        res.end();
      }
    }
  },
);

// ─── Machine product-key mappings ────────────────────────────────────────────
// The receiver at POST /api/integrations/machine-purchase translates each
// `portal_product_keys` entry from The Machine onto a Portal product slug
// using `machine_product_key_mappings`. Admins manage that table here, and
// can review/dismiss unknown keys that came in without a mapping. See
// task #493 and `artifacts/api-server/src/lib/machine-product-key-mappings.ts`.

// Machine product keys come in two shapes: legacy single snake_case keys
// (e.g. `yse_front_end`) and colon-qualified funnel keys (e.g. `backroad:bump`,
// `{offer}:{slot}`) that the Fulfillment Map creates/overrides per offer slot.
// Allow lowercase letters/digits/underscores with at most one colon-qualified
// suffix so both shapes can be written through this CRUD.
const MACHINE_KEY_PATTERN = /^[a-z0-9_]+(:[a-z0-9_]+)?$/;

function validateMappingInput(body: unknown):
  | { ok: true; data: { machineKey: string; portalSlug: string; notes: string | null } }
  | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.machineKey !== "string" || b.machineKey.length < 1 || b.machineKey.length > 64 || !MACHINE_KEY_PATTERN.test(b.machineKey)) {
    return { ok: false, message: "machineKey must be lowercase letters/digits/underscores, optionally with one colon-qualified suffix (e.g. backroad:bump), 1–64 chars" };
  }
  if (typeof b.portalSlug !== "string" || b.portalSlug.trim().length < 1 || b.portalSlug.length > 128) {
    return { ok: false, message: "portalSlug must be a non-empty string of ≤128 chars" };
  }
  const notes =
    typeof b.notes === "string" && b.notes.trim() !== "" ? b.notes.trim() : null;
  return {
    ok: true,
    data: {
      machineKey: b.machineKey,
      portalSlug: b.portalSlug.trim(),
      notes,
    },
  };
}

router.get(
  "/admin/integrations/machine-product-key-mappings",
  requirePermission("members:view"),
  async (_req: Request, res: Response) => {
    try {
      const rows = await db
        .select({
          id: machineProductKeyMappingsTable.id,
          machineKey: machineProductKeyMappingsTable.machineKey,
          portalSlug: machineProductKeyMappingsTable.portalSlug,
          notes: machineProductKeyMappingsTable.notes,
          createdAt: machineProductKeyMappingsTable.createdAt,
          updatedAt: machineProductKeyMappingsTable.updatedAt,
          updatedBy: machineProductKeyMappingsTable.updatedBy,
        })
        .from(machineProductKeyMappingsTable)
        .orderBy(asc(machineProductKeyMappingsTable.machineKey));
      res.json({ mappings: rows });
    } catch (error) {
      console.error("[Admin] List machine product key mappings error:", error);
      res.status(500).json({ error: "Failed to list mappings" });
    }
  },
);

router.post(
  "/admin/integrations/machine-product-key-mappings",
  requirePermission("members:edit"),
  async (req: Request, res: Response) => {
    const validation = validateMappingInput(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    try {
      const actor = req.user?.email ?? `user:${req.user?.userId ?? "unknown"}`;
      const [row] = await db
        .insert(machineProductKeyMappingsTable)
        .values({
          machineKey: validation.data.machineKey,
          portalSlug: validation.data.portalSlug,
          notes: validation.data.notes,
          updatedBy: actor,
        })
        .returning();
      await logAdminAction(
        req,
        "create",
        "machine_product_key_mapping",
        String(row.id),
        `Mapped ${row.machineKey} → ${row.portalSlug}`,
      );
      res.status(201).json({ mapping: row });
    } catch (error: any) {
      const code = error?.code ?? error?.cause?.code;
      const message = `${error?.message ?? ""} ${error?.cause?.message ?? ""}`;
      if (
        code === "23505" ||
        /duplicate key|unique constraint|machine_product_key_mappings_machine_key/i.test(message)
      ) {
        res.status(409).json({ error: "machineKey already mapped" });
        return;
      }
      console.error("[Admin] Create machine product key mapping error:", error);
      res.status(500).json({ error: "Failed to create mapping" });
    }
  },
);

router.patch(
  "/admin/integrations/machine-product-key-mappings/:id",
  requirePermission("members:edit"),
  async (req: Request, res: Response) => {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid mapping id" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const update: { portalSlug?: string; notes?: string | null; updatedBy?: string } = {};
    if ("portalSlug" in body) {
      if (typeof body.portalSlug !== "string" || body.portalSlug.trim().length < 1 || body.portalSlug.length > 128) {
        res.status(400).json({ error: "portalSlug must be a non-empty string of ≤128 chars" });
        return;
      }
      update.portalSlug = body.portalSlug.trim();
    }
    if ("notes" in body) {
      if (body.notes === null) {
        update.notes = null;
      } else if (typeof body.notes === "string") {
        update.notes = body.notes.trim() === "" ? null : body.notes.trim();
      } else {
        res.status(400).json({ error: "notes must be a string or null" });
        return;
      }
    }
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "No editable fields supplied" });
      return;
    }
    update.updatedBy = req.user?.email ?? `user:${req.user?.userId ?? "unknown"}`;
    try {
      const [row] = await db
        .update(machineProductKeyMappingsTable)
        .set(update)
        .where(eq(machineProductKeyMappingsTable.id, id))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Mapping not found" });
        return;
      }
      await logAdminAction(
        req,
        "update",
        "machine_product_key_mapping",
        String(id),
        `Updated mapping ${row.machineKey} → ${row.portalSlug}`,
      );
      res.json({ mapping: row });
    } catch (error) {
      console.error("[Admin] Update machine product key mapping error:", error);
      res.status(500).json({ error: "Failed to update mapping" });
    }
  },
);

router.delete(
  "/admin/integrations/machine-product-key-mappings/:id",
  requirePermission("members:edit"),
  async (req: Request, res: Response) => {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid mapping id" });
      return;
    }
    try {
      const [row] = await db
        .delete(machineProductKeyMappingsTable)
        .where(eq(machineProductKeyMappingsTable.id, id))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Mapping not found" });
        return;
      }
      await logAdminAction(
        req,
        "delete",
        "machine_product_key_mapping",
        String(id),
        `Removed mapping ${row.machineKey} → ${row.portalSlug}`,
      );
      res.json({ ok: true });
    } catch (error) {
      console.error("[Admin] Delete machine product key mapping error:", error);
      res.status(500).json({ error: "Failed to delete mapping" });
    }
  },
);

router.get(
  "/admin/integrations/machine-unknown-product-keys",
  requirePermission("members:view"),
  async (req: Request, res: Response) => {
    try {
      const includeDismissed = req.query.includeDismissed === "true";
      const conditions: SQL[] = [];
      if (!includeDismissed) {
        conditions.push(isNull(machineUnknownProductKeysTable.dismissedAt));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const rows = await db
        .select()
        .from(machineUnknownProductKeysTable)
        .where(where as SQL | undefined)
        .orderBy(desc(machineUnknownProductKeysTable.lastSeenAt))
        .limit(200);
      res.json({ unknownKeys: rows });
    } catch (error) {
      console.error("[Admin] List unknown machine product keys error:", error);
      res.status(500).json({ error: "Failed to list unknown keys" });
    }
  },
);

router.post(
  "/admin/integrations/machine-unknown-product-keys/:id/dismiss",
  requirePermission("members:edit"),
  async (req: Request, res: Response) => {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const actor = req.user?.email ?? `user:${req.user?.userId ?? "unknown"}`;
      const [row] = await db
        .update(machineUnknownProductKeysTable)
        .set({ dismissedAt: new Date(), dismissedBy: actor })
        .where(eq(machineUnknownProductKeysTable.id, id))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Unknown key row not found" });
        return;
      }
      await logAdminAction(
        req,
        "dismiss",
        "machine_unknown_product_key",
        String(id),
        `Dismissed unknown machine key ${row.machineKey}`,
      );
      res.json({ unknownKey: row });
    } catch (error) {
      console.error("[Admin] Dismiss unknown machine product key error:", error);
      res.status(500).json({ error: "Failed to dismiss" });
    }
  },
);

export default router;
