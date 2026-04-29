/**
 * Sends real on-call notifications when the auth rate-limit burst threshold
 * is crossed. The dashboard "Needs Attention" panel surfaces the same burst
 * inline, but a real attack at 3am is missed if no admin happens to be
 * looking — this alerter wires the same on-call path used by the
 * queue-fallback alerter so the page goes out regardless.
 *
 * Behavior:
 *   - Counts the recent `auth_rate_limit_blocked` audit rows in a trailing
 *     window (default 15m) and decides "currently bursting?" against a
 *     configurable threshold (default 10 hits in window).
 *   - On the not-alerting → alerting transition, dispatches a "fire" alert
 *     to every configured on-call destination.
 *   - On the alerting → not-alerting transition, dispatches an "all clear".
 *   - Each delivery channel is throttled per kind to at most one
 *     notification per AUTH_RATE_LIMIT_NOTIFICATION_THROTTLE_MS (default
 *     1 hour) so a sustained attack can't re-page on-call every minute.
 *   - One audit-log row is written per delivery attempt — including
 *     suppressed/skipped/throttled ones — so admins reviewing an incident
 *     can confirm what fired and what didn't.
 *   - PagerDuty incidents use a stable dedup_key
 *     (`auth-rate-limit-burst:default`) so re-triggers fold into the
 *     existing incident and a "resolve" event auto-closes it.
 *
 * Concurrency: the route-level dispatch (when an admin loads
 * `/admin/dashboard/needs-attention`) is fire-and-forget while the
 * background poll runs every few minutes. Both call sites share
 * `alertState.alerting`, so we flip the transition flag *before* awaiting
 * the dispatch — any concurrent call that arrives mid-dispatch sees the
 * new state and returns immediately instead of double-paging.
 *
 * Configuration:
 *   - On-call destinations are read fresh from `oncall-settings` on every
 *     dispatch, so admin edits via the Settings UI take effect without a
 *     restart. Values fall back to env vars (PAGERDUTY_INTEGRATION_KEY,
 *     OPS_ALERT_EMAIL, OPS_ALERT_SLACK_WEBHOOK_URL) for deploys that
 *     haven't migrated to the DB store.
 *   - Threshold, window length, and dominant-IP ratio are read fresh from
 *     `auth-rate-limit-alert-settings` on every evaluation (cached ~10s
 *     inside that module), so admins can tune them from the Settings UI
 *     without restarting the API.
 *   - Throttle and poll cadence are tunable via env vars
 *     (AUTH_RATE_LIMIT_NOTIFICATION_THROTTLE_MS,
 *     AUTH_RATE_LIMIT_ALERTER_POLL_MS) with safe defaults.
 */

import sgMail from "@sendgrid/mail";
import { db, auditLogTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { logAuditEvent } from "./audit-log";
import { getOnCallDestinations } from "./oncall-settings";
import {
  getAuthRateLimitAlertConfig,
  AUTH_RATE_LIMIT_ALERT_DEFAULTS,
  type AuthRateLimitAlertConfig,
} from "./auth-rate-limit-alert-settings";
import { AUTH_RATE_LIMIT_AUDIT_ACTION } from "../routes/auth";

export type DeliveryChannel = "pagerduty" | "email" | "slack";
export type AlertKind = "fire" | "clear";

/**
 * Audit log action / entity types used to record on-call alert delivery
 * attempts for the auth-rate-limit alerter. Exported so the cleanup job,
 * admin filters, and tests can refer to a single source of truth.
 */
export const AUTH_RATE_LIMIT_ALERT_ACTION_TYPE = "auth_rate_limit_alert";
export const AUTH_RATE_LIMIT_ALERT_ENTITY_TYPE = "alert";
/** Stable entityId so admins can group/filter alert rows for this alerter. */
export const AUTH_RATE_LIMIT_ALERT_ENTITY_ID = "auth_rate_limit_burst";

/**
 * Outcome of a single delivery attempt, derived from the DeliveryResult.
 * Stored on the audit row so admins can filter / count without parsing
 * the description string. Mirrors the queue-fallback alerter's audit
 * shape so a single Audit Log filter UI works for both.
 */
export type AlertDeliveryOutcome = "sent" | "failed" | "throttled" | "skipped";

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getNotificationThrottleMs(): number {
  return parseEnvInt(
    "AUTH_RATE_LIMIT_NOTIFICATION_THROTTLE_MS",
    60 * 60 * 1000,
  );
}

/**
 * Read the dynamic alert config (threshold / windowMinutes / dominantIpRatio)
 * from `auth-rate-limit-alert-settings`, with a defensive fallback to the
 * shipped defaults if the underlying read throws. The settings module
 * already caches reads for ~10s and degrades to defaults on DB errors, so
 * this wrapper exists only to make the alerter resilient to a settings
 * module that someone later refactors to throw on misconfig.
 */
async function loadAlertConfig(): Promise<AuthRateLimitAlertConfig> {
  try {
    return await getAuthRateLimitAlertConfig();
  } catch (err) {
    console.error(
      "[AuthRateLimitAlerter] failed to load alert config, using defaults:",
      err,
    );
    return { ...AUTH_RATE_LIMIT_ALERT_DEFAULTS };
  }
}

const POLL_MS = parseEnvInt("AUTH_RATE_LIMIT_ALERTER_POLL_MS", 5 * 60 * 1000);

/**
 * Aggregate stats describing the recent auth-rate-limit activity. Returned
 * by `evaluateAuthRateLimitAlert` so the dashboard "Needs Attention" panel
 * can render the same numbers the alerter used to make its decision —
 * single source of truth for both the inline UI and the page.
 */
export interface AuthRateLimitBurstStats {
  /** Total auth_rate_limit_blocked rows observed in the trailing window. */
  total: number;
  /** Width of the trailing window in ms. */
  windowMs: number;
  /** Threshold the total was compared against. */
  threshold: number;
  /** True iff total >= threshold. */
  alerting: boolean;
  /** IP with the most hits in the window, or null if no IPs were captured. */
  dominantIp: string | null;
  /** Number of hits attributable to `dominantIp`. */
  dominantCount: number;
  /** dominantCount / total (0 when total === 0). */
  dominantShare: number;
  /**
   * Fraction of the total at which a single source IP is considered
   * "dominant" — admin-editable from Settings, defaults to 0.6. Surfaced
   * here so callers (the dashboard UI and the alert summary builders) use
   * the *same* threshold the alerter just used to make its decision and
   * don't have to re-read the settings module.
   */
  dominantIpRatio: number;
  /**
   * False when the underlying burst-stats query failed (e.g. transient DB
   * outage). Callers that need to *act* on the stats (the alerter's
   * transition logic) must skip dispatch in that case so a failed query
   * doesn't masquerade as "all clear" and silently resolve a real
   * incident. Read-only callers (the dashboard UI) can still render the
   * fallback stats — they simply won't show a burst.
   */
  statsAvailable: boolean;
}

export interface AuthRateLimitAlertPayload {
  kind: AlertKind;
  stats: AuthRateLimitBurstStats;
  now: number;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  ok: boolean;
  /** True if no notification was attempted (e.g. provider not configured or throttled). */
  skipped?: boolean;
  reason?: string;
}

export interface AuthRateLimitEvaluation {
  /** Computed stats for the trailing window. */
  stats: AuthRateLimitBurstStats;
  /**
   * Per-delivery results from this evaluation. Empty when the alerting
   * state did not transition (i.e. nothing was dispatched).
   */
  deliveries: DeliveryResult[];
}

interface AlertState {
  /** True if we currently consider the auth rate-limit "alerting". */
  alerting: boolean;
  /** Per-delivery-channel timestamp of the last successful "fire" send. */
  lastFireAt: Partial<Record<DeliveryChannel, number>>;
  /** Per-delivery-channel timestamp of the last successful "clear" send. */
  lastClearAt: Partial<Record<DeliveryChannel, number>>;
}

const alertState: AlertState = {
  alerting: false,
  lastFireAt: {},
  lastClearAt: {},
};

type DeliveryFn = (
  payload: AuthRateLimitAlertPayload,
) => Promise<DeliveryResult>;

let sgMailInitialized = false;

function buildFireSummary(stats: AuthRateLimitBurstStats): string {
  const minutes = Math.round(stats.windowMs / 60000);
  const ipSuffix =
    stats.dominantIp && stats.dominantShare >= stats.dominantIpRatio
      ? ` — ${stats.dominantCount} from ${stats.dominantIp}`
      : "";
  return `Auth rate-limit burst — ${stats.total} hits in the last ${minutes}m (threshold ${stats.threshold})${ipSuffix}`;
}

function buildClearSummary(stats: AuthRateLimitBurstStats): string {
  const minutes = Math.round(stats.windowMs / 60000);
  return `Auth rate-limit burst recovered — ${stats.total} hits in the last ${minutes}m, back below threshold ${stats.threshold}`;
}

const defaultDeliveries: Record<DeliveryChannel, DeliveryFn> = {
  pagerduty: async (p) => {
    const dest = await getOnCallDestinations();
    const key = dest.pagerdutyIntegrationKey;
    if (!key) {
      return {
        channel: "pagerduty",
        ok: true,
        skipped: true,
        reason: "not_configured",
      };
    }
    // Stable dedup key — re-triggers fold into the existing incident and a
    // resolve event auto-closes it.
    const dedupKey = "auth-rate-limit-burst:default";
    const summary =
      p.kind === "fire" ? buildFireSummary(p.stats) : buildClearSummary(p.stats);
    const body =
      p.kind === "fire"
        ? {
            routing_key: key,
            event_action: "trigger",
            dedup_key: dedupKey,
            payload: {
              summary,
              severity: "error",
              source: process.env.HOSTNAME ?? "api-server",
              component: "auth",
              class: "auth_rate_limit_burst",
              custom_details: {
                total: p.stats.total,
                windowMs: p.stats.windowMs,
                threshold: p.stats.threshold,
                dominantIp: p.stats.dominantIp,
                dominantCount: p.stats.dominantCount,
                dominantShare: p.stats.dominantShare,
              },
            },
          }
        : {
            routing_key: key,
            event_action: "resolve",
            dedup_key: dedupKey,
          };
    const res = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { channel: "pagerduty", ok: false, reason: `http_${res.status}` };
    }
    return { channel: "pagerduty", ok: true };
  },

  email: async (p) => {
    const dest = await getOnCallDestinations();
    const to = dest.opsAlertEmail;
    if (!to) {
      return {
        channel: "email",
        ok: true,
        skipped: true,
        reason: "not_configured",
      };
    }
    if (!process.env.SENDGRID_API_KEY) {
      return {
        channel: "email",
        ok: true,
        skipped: true,
        reason: "sendgrid_not_configured",
      };
    }
    if (!sgMailInitialized) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      sgMailInitialized = true;
    }
    const from =
      process.env.OPS_ALERT_FROM_EMAIL ??
      process.env.FROM_EMAIL ??
      "noreply@buildtestscale.com";
    const minutes = Math.round(p.stats.windowMs / 60000);
    const subject =
      p.kind === "fire"
        ? "[ALERT] Auth rate-limit burst detected"
        : "[RESOLVED] Auth rate-limit burst recovered";
    const ipLine =
      p.stats.dominantIp && p.stats.dominantShare >= p.stats.dominantIpRatio
        ? `Dominant source: ${p.stats.dominantIp} (${p.stats.dominantCount} of ${p.stats.total} hits)`
        : "No single dominant source IP — burst is spread across multiple addresses.";
    const text =
      p.kind === "fire"
        ? [
            `${p.stats.total} auth rate-limit hits were observed in the last ${minutes} minute(s).`,
            `Threshold for paging on-call: ${p.stats.threshold}.`,
            ipLine,
            "",
            "This usually indicates a credential-stuffing or login-probing wave.",
            "Review the audit log filter for actionType=auth_rate_limit_blocked,",
            "and consider tightening upstream rate limits if the burst is sustained.",
          ].join("\n")
        : [
            `Auth rate-limit hits in the last ${minutes} minute(s): ${p.stats.total}.`,
            `Now back below the paging threshold of ${p.stats.threshold}.`,
            "",
            "Marking the alert resolved.",
          ].join("\n");
    await sgMail.send({ to, from, subject, text });
    return { channel: "email", ok: true };
  },

  slack: async (p) => {
    const dest = await getOnCallDestinations();
    const url = dest.opsAlertSlackWebhookUrl;
    if (!url) {
      return {
        channel: "slack",
        ok: true,
        skipped: true,
        reason: "not_configured",
      };
    }
    const minutes = Math.round(p.stats.windowMs / 60000);
    const ipSuffix =
      p.stats.dominantIp && p.stats.dominantShare >= p.stats.dominantIpRatio
        ? ` (${p.stats.dominantCount} from ${p.stats.dominantIp})`
        : "";
    const text =
      p.kind === "fire"
        ? `:rotating_light: *Auth rate-limit burst* — ${p.stats.total} hits in the last ${minutes}m${ipSuffix}, threshold ${p.stats.threshold}. Likely credential stuffing; review the audit log.`
        : `:white_check_mark: *Auth rate-limit burst recovered* — ${p.stats.total} hits in the last ${minutes}m, back below threshold ${p.stats.threshold}.`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      return { channel: "slack", ok: false, reason: `http_${res.status}` };
    }
    return { channel: "slack", ok: true };
  },
};

let deliveryOverrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null =
  null;

/** Test-only: replace one or more delivery functions with stubs. */
export function __setAuthRateLimitAlerterDeliveriesForTests(
  overrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null,
): void {
  deliveryOverrides = overrides;
}

/** Test-only: reset all alerter state. */
export function __resetAuthRateLimitAlerterForTests(): void {
  alertState.alerting = false;
  alertState.lastFireAt = {};
  alertState.lastClearAt = {};
  deliveryOverrides = null;
}

/**
 * Map a `DeliveryResult` to the coarse outcome bucket recorded on the
 * audit row. Keeping this derivation in one place means the description
 * string and `metadata.outcome` always agree.
 */
function classifyOutcome(result: DeliveryResult): AlertDeliveryOutcome {
  if (!result.ok) return "failed";
  if (result.skipped) {
    return result.reason === "throttled" ? "throttled" : "skipped";
  }
  return "sent";
}

function describeAttempt(
  payload: AuthRateLimitAlertPayload,
  result: DeliveryResult,
  outcome: AlertDeliveryOutcome,
): string {
  const verb = payload.kind === "fire" ? "fire" : "clear";
  const reasonSuffix = result.reason ? ` (${result.reason})` : "";
  switch (outcome) {
    case "sent":
      return `Sent ${verb} alert via ${result.channel} for auth rate-limit burst`;
    case "failed":
      return `Failed to send ${verb} alert via ${result.channel} for auth rate-limit burst${reasonSuffix}`;
    case "throttled":
      return `Throttled ${verb} alert via ${result.channel} for auth rate-limit burst${reasonSuffix}`;
    case "skipped":
      return `Skipped ${verb} alert via ${result.channel} for auth rate-limit burst${reasonSuffix}`;
  }
}

/**
 * Persist a single delivery attempt as an audit log row so admins reviewing
 * an incident later can confirm whether on-call was paged, why an attempt
 * was skipped/throttled, etc. Fire-and-forget — `logAuditEvent` already
 * swallows DB errors so a flaky audit table can never break alert dispatch.
 */
async function recordDeliveryAttempt(
  payload: AuthRateLimitAlertPayload,
  result: DeliveryResult,
): Promise<void> {
  const outcome = classifyOutcome(result);
  await logAuditEvent({
    actionType: AUTH_RATE_LIMIT_ALERT_ACTION_TYPE,
    entityType: AUTH_RATE_LIMIT_ALERT_ENTITY_TYPE,
    entityId: AUTH_RATE_LIMIT_ALERT_ENTITY_ID,
    description: describeAttempt(payload, result, outcome),
    metadata: {
      deliveryChannel: result.channel,
      kind: payload.kind,
      outcome,
      reason: result.reason ?? null,
      total: payload.stats.total,
      threshold: payload.stats.threshold,
      windowMs: payload.stats.windowMs,
      dominantIp: payload.stats.dominantIp,
      dominantCount: payload.stats.dominantCount,
      dominantShare: payload.stats.dominantShare,
    },
  });
}

async function dispatchAll(
  payload: AuthRateLimitAlertPayload,
): Promise<DeliveryResult[]> {
  const lastMap =
    payload.kind === "fire" ? alertState.lastFireAt : alertState.lastClearAt;
  const throttleMs = getNotificationThrottleMs();
  const promises: Promise<DeliveryResult>[] = (
    ["pagerduty", "email", "slack"] as const
  ).map(async (dc) => {
    const last = lastMap[dc] ?? 0;
    if (last > 0 && payload.now - last < throttleMs) {
      return { channel: dc, ok: true, skipped: true, reason: "throttled" };
    }
    const fn = deliveryOverrides?.[dc] ?? defaultDeliveries[dc];
    try {
      const result = await fn(payload);
      // Only consume the throttle slot when something was actually sent —
      // a "skipped" (no provider configured) shouldn't gate the next attempt.
      if (result.ok && !result.skipped) {
        lastMap[dc] = payload.now;
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[AuthRateLimitAlerter] ${dc} ${payload.kind} failed:`,
        err,
      );
      return { channel: dc, ok: false, reason };
    }
  });
  const results = await Promise.all(promises);
  // Record one audit row per delivery attempt (including throttled/skipped
  // ones). Awaited so callers / tests observing dispatch completion also
  // see the audit rows; logAuditEvent swallows DB errors internally so
  // this can't throw.
  await Promise.all(results.map((r) => recordDeliveryAttempt(payload, r)));
  return results;
}

async function computeBurstStats(
  now: number,
): Promise<AuthRateLimitBurstStats> {
  // Pull the live config from `auth-rate-limit-alert-settings` so admins
  // can tune the alert from the Settings UI without a restart. The
  // settings module caches reads (~10s) and degrades to defaults on its
  // own DB errors, so this is cheap.
  const config = await loadAlertConfig();
  const windowMs = config.windowMinutes * 60 * 1000;
  const threshold = config.threshold;
  const dominantIpRatio = config.dominantIpRatio;
  const since = new Date(now - windowMs);
  let groups: Array<{ ip: string | null; count: number }> = [];
  let statsAvailable = true;
  try {
    groups = await db
      .select({
        ip: auditLogTable.ipAddress,
        count: sql<number>`count(*)`,
      })
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION),
          gte(auditLogTable.createdAt, since),
        ),
      )
      .groupBy(auditLogTable.ipAddress);
  } catch (err) {
    // Mark stats as unavailable so the transition logic in
    // evaluateAuthRateLimitAlert() does NOT treat a transient DB error as
    // "all clear" — that would auto-resolve a real, ongoing incident.
    console.error("[AuthRateLimitAlerter] burst-stats query failed:", err);
    statsAvailable = false;
    groups = [];
  }
  let total = 0;
  let dominantIp: string | null = null;
  let dominantCount = 0;
  for (const row of groups) {
    const c = Number(row.count || 0);
    total += c;
    if (row.ip && c > dominantCount) {
      dominantIp = row.ip;
      dominantCount = c;
    }
  }
  const dominantShare = total > 0 ? dominantCount / total : 0;
  return {
    total,
    windowMs,
    threshold,
    // When stats are unavailable, force `alerting: false` so the dashboard
    // doesn't render a phantom alert from a zeroed-out result. The
    // transition logic ignores this field when statsAvailable is false.
    alerting: statsAvailable && total >= threshold,
    dominantIp,
    dominantCount,
    dominantShare,
    dominantIpRatio,
    statsAvailable,
  };
}

/**
 * Compute the burst stats and dispatch any state-transition alerts.
 *
 * The `stats` field is always populated so callers (the dashboard
 * `Needs Attention` route in particular) can render the same numbers the
 * alerter just used. The `deliveries` array is empty when the alerting
 * state did not transition.
 *
 * Concurrency: the transition flag is flipped synchronously *before*
 * awaiting the dispatch, so two concurrent evaluations of the same
 * first-time outage still only dispatch once.
 */
export async function evaluateAuthRateLimitAlert(
  now: number = Date.now(),
): Promise<AuthRateLimitEvaluation> {
  const stats = await computeBurstStats(now);
  // If the stats query failed we have no idea whether the burst is still
  // active, so we must NOT make a transition decision in either direction.
  // Doing nothing preserves the previous alerting state — a real ongoing
  // incident keeps its open page, and a quiet system stays quiet — until
  // the next poll succeeds.
  if (!stats.statsAvailable) {
    return { stats, deliveries: [] };
  }
  const prev = alertState.alerting;
  if (stats.alerting && !prev) {
    alertState.alerting = true;
    const deliveries = await dispatchAll({ kind: "fire", stats, now });
    return { stats, deliveries };
  }
  if (!stats.alerting && prev) {
    alertState.alerting = false;
    const deliveries = await dispatchAll({ kind: "clear", stats, now });
    return { stats, deliveries };
  }
  return { stats, deliveries: [] };
}

let pollHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Start the recovery poll so a burst is detected and a "clear" eventually
 * fires even if no admin loads the dashboard. Idempotent.
 */
export function startAuthRateLimitAlerter(): void {
  if (started) return;
  started = true;
  evaluateAuthRateLimitAlert().catch((err) => {
    console.error("[AuthRateLimitAlerter] startup error:", err);
  });
  if (POLL_MS > 0) {
    pollHandle = setInterval(() => {
      evaluateAuthRateLimitAlert().catch((err) => {
        console.error("[AuthRateLimitAlerter] poll error:", err);
      });
    }, POLL_MS);
    pollHandle.unref?.();
  }
}

/** Stop the poll. */
export function stopAuthRateLimitAlerter(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  started = false;
}

/** Test-only: read the current `alerting` flag without mutating it. */
export function __getAuthRateLimitAlerterStateForTests(): boolean {
  return alertState.alerting;
}
