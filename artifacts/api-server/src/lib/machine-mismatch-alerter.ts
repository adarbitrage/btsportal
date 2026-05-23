/**
 * Sends real on-call notifications when Machine orders start mismatching
 * what we actually granted (task #494). The admin Integrations page surfaces
 * the per-row mismatch flag for spot-checks, but a drift between The
 * Machine's `portal_product_keys` and what the grant pipeline writes is
 * silent otherwise — this alerter wires the same on-call path used by the
 * auth-rate-limit alerter so a wave of mismatches pages on-call regardless
 * of who's looking.
 *
 * Behavior:
 *   - Polls every few minutes. Counts distinct Machine orders whose granted
 *     product slugs disagree with their captured `portal_product_keys`,
 *     scoped to a trailing window (default 24h). Threshold + window are
 *     read fresh from `machine-mismatch-alert-settings` every evaluation so
 *     admins can tune from Settings without restarting.
 *   - On the not-alerting → alerting transition, dispatches a "fire" to
 *     every configured on-call destination.
 *   - On the alerting → not-alerting transition, dispatches an "all clear".
 *   - Each delivery channel is throttled per kind to at most one
 *     notification per MACHINE_MISMATCH_NOTIFICATION_THROTTLE_MS (default
 *     1 hour) so a sustained issue can't re-page every poll.
 *   - One audit-log row is written per delivery attempt (including skipped /
 *     throttled / failed). Action type `machine_mismatch_alert`, entity type
 *     `alert` — same shape as the queue-fallback / auth-rate-limit alerters,
 *     so the System Health alert timeline picks them up via its inArray
 *     filter without any extra plumbing.
 *   - PagerDuty incidents use a stable dedup_key
 *     (`machine-order-mismatch:default`) so re-triggers fold into the
 *     existing incident and a "resolve" event auto-closes it.
 *
 * Stats unavailability: when the underlying mismatch-count query fails
 * (transient DB outage), the alerter preserves the previous alerting state
 * — we must NOT auto-resolve a real ongoing incident just because a single
 * poll couldn't reach the DB.
 */

import sgMail from "@sendgrid/mail";
import {
  db,
  userProductsTable,
  productsTable,
  webhookLogsTable,
} from "@workspace/db";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { logAuditEvent } from "./audit-log";
import { getOnCallDestinations } from "./oncall-settings";
import {
  getMachineMismatchAlertConfig,
  MACHINE_MISMATCH_ALERT_DEFAULTS,
  type MachineMismatchAlertConfig,
} from "./machine-mismatch-alert-settings";
import {
  computeOrderMismatch,
  parsePortalProductKeys,
} from "./external-order-mismatch";

export type DeliveryChannel = "pagerduty" | "email" | "slack";
export type AlertKind = "fire" | "clear";

/**
 * Audit log action / entity types used to record on-call alert delivery
 * attempts for this alerter. Exported so the admin filters, the System
 * Health alert timeline (which inArray's across all alerter action types),
 * and tests can refer to a single source of truth.
 */
export const MACHINE_MISMATCH_ALERT_ACTION_TYPE = "machine_mismatch_alert";
export const MACHINE_MISMATCH_ALERT_ENTITY_TYPE = "alert";
/** Stable entityId so admins can group / filter alert rows for this alerter. */
export const MACHINE_MISMATCH_ALERT_ENTITY_ID = "machine_order_mismatch";

export type AlertDeliveryOutcome = "sent" | "failed" | "throttled" | "skipped";

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getNotificationThrottleMs(): number {
  return parseEnvInt(
    "MACHINE_MISMATCH_NOTIFICATION_THROTTLE_MS",
    60 * 60 * 1000,
  );
}

async function loadAlertConfig(): Promise<MachineMismatchAlertConfig> {
  try {
    return await getMachineMismatchAlertConfig();
  } catch (err) {
    console.error(
      "[MachineMismatchAlerter] failed to load alert config, using defaults:",
      err,
    );
    return { ...MACHINE_MISMATCH_ALERT_DEFAULTS };
  }
}

const POLL_MS = parseEnvInt(
  "MACHINE_MISMATCH_ALERTER_POLL_MS",
  5 * 60 * 1000,
);

export interface MachineMismatchStats {
  /** Distinct mismatched Machine orders observed in the trailing window. */
  total: number;
  /** Width of the trailing window in ms. */
  windowMs: number;
  /** Threshold the total was compared against. */
  threshold: number;
  /** True iff total >= threshold. */
  alerting: boolean;
  /**
   * Up to a handful of recent example order IDs (most recent first) so the
   * page body has something an on-call admin can grep the admin UI for
   * without first opening a database console.
   */
  sampleOrderIds: string[];
  /** False when the count query failed — see module comment. */
  statsAvailable: boolean;
}

export interface MachineMismatchAlertPayload {
  kind: AlertKind;
  stats: MachineMismatchStats;
  now: number;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

export interface MachineMismatchEvaluation {
  stats: MachineMismatchStats;
  deliveries: DeliveryResult[];
}

interface AlertState {
  alerting: boolean;
  lastFireAt: Partial<Record<DeliveryChannel, number>>;
  lastClearAt: Partial<Record<DeliveryChannel, number>>;
}

const alertState: AlertState = {
  alerting: false,
  lastFireAt: {},
  lastClearAt: {},
};

type DeliveryFn = (
  payload: MachineMismatchAlertPayload,
) => Promise<DeliveryResult>;

let sgMailInitialized = false;

function buildFireSummary(stats: MachineMismatchStats): string {
  const hours = Math.round(stats.windowMs / (60 * 60 * 1000));
  return `Machine order mismatch — ${stats.total} mismatched orders in the last ${hours}h (threshold ${stats.threshold})`;
}

function buildClearSummary(stats: MachineMismatchStats): string {
  const hours = Math.round(stats.windowMs / (60 * 60 * 1000));
  return `Machine order mismatch recovered — ${stats.total} mismatched orders in the last ${hours}h, back below threshold ${stats.threshold}`;
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
    const dedupKey = "machine-order-mismatch:default";
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
              component: "integrations.machine",
              class: "machine_order_mismatch",
              custom_details: {
                total: p.stats.total,
                windowMs: p.stats.windowMs,
                threshold: p.stats.threshold,
                sampleOrderIds: p.stats.sampleOrderIds,
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
    const hours = Math.round(p.stats.windowMs / (60 * 60 * 1000));
    const subject =
      p.kind === "fire"
        ? "[ALERT] Machine order grant mismatch wave"
        : "[RESOLVED] Machine order grant mismatch recovered";
    const sampleLine =
      p.stats.sampleOrderIds.length > 0
        ? `Recent mismatched orders: ${p.stats.sampleOrderIds.join(", ")}`
        : "No example order IDs available.";
    const text =
      p.kind === "fire"
        ? [
            `${p.stats.total} Machine orders in the last ${hours}h were granted product slugs that don't match The Machine's portal_product_keys.`,
            `Threshold for paging on-call: ${p.stats.threshold}.`,
            sampleLine,
            "",
            "This usually means The Machine started sending a portal_product_key the grant pipeline doesn't recognise,",
            "or a product slug was renamed without updating The Machine's catalogue.",
            "Inspect /admin/integrations/yse?source=machine to see flagged orders side-by-side.",
          ].join("\n")
        : [
            `Mismatched Machine orders in the last ${hours}h: ${p.stats.total}.`,
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
    const hours = Math.round(p.stats.windowMs / (60 * 60 * 1000));
    const sampleSuffix =
      p.stats.sampleOrderIds.length > 0
        ? ` (e.g. ${p.stats.sampleOrderIds.slice(0, 3).join(", ")})`
        : "";
    const text =
      p.kind === "fire"
        ? `:rotating_light: *Machine order mismatch* — ${p.stats.total} mismatched orders in the last ${hours}h${sampleSuffix}, threshold ${p.stats.threshold}. Inspect /admin/integrations/yse?source=machine.`
        : `:white_check_mark: *Machine order mismatch recovered* — ${p.stats.total} mismatched orders in the last ${hours}h, back below threshold ${p.stats.threshold}.`;
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
export function __setMachineMismatchAlerterDeliveriesForTests(
  overrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null,
): void {
  deliveryOverrides = overrides;
}

/** Test-only: reset all alerter state. */
export function __resetMachineMismatchAlerterForTests(): void {
  alertState.alerting = false;
  alertState.lastFireAt = {};
  alertState.lastClearAt = {};
  deliveryOverrides = null;
}

/** Test-only: read the current `alerting` flag without mutating it. */
export function __getMachineMismatchAlerterStateForTests(): boolean {
  return alertState.alerting;
}

function classifyOutcome(result: DeliveryResult): AlertDeliveryOutcome {
  if (!result.ok) return "failed";
  if (result.skipped) {
    return result.reason === "throttled" ? "throttled" : "skipped";
  }
  return "sent";
}

function describeAttempt(
  payload: MachineMismatchAlertPayload,
  result: DeliveryResult,
  outcome: AlertDeliveryOutcome,
): string {
  const verb = payload.kind === "fire" ? "fire" : "clear";
  const reasonSuffix = result.reason ? ` (${result.reason})` : "";
  switch (outcome) {
    case "sent":
      return `Sent ${verb} alert via ${result.channel} for Machine order mismatch`;
    case "failed":
      return `Failed to send ${verb} alert via ${result.channel} for Machine order mismatch${reasonSuffix}`;
    case "throttled":
      return `Throttled ${verb} alert via ${result.channel} for Machine order mismatch${reasonSuffix}`;
    case "skipped":
      return `Skipped ${verb} alert via ${result.channel} for Machine order mismatch${reasonSuffix}`;
  }
}

async function recordDeliveryAttempt(
  payload: MachineMismatchAlertPayload,
  result: DeliveryResult,
): Promise<void> {
  const outcome = classifyOutcome(result);
  await logAuditEvent({
    actionType: MACHINE_MISMATCH_ALERT_ACTION_TYPE,
    entityType: MACHINE_MISMATCH_ALERT_ENTITY_TYPE,
    entityId: MACHINE_MISMATCH_ALERT_ENTITY_ID,
    description: describeAttempt(payload, result, outcome),
    metadata: {
      deliveryChannel: result.channel,
      kind: payload.kind,
      outcome,
      reason: result.reason ?? null,
      total: payload.stats.total,
      threshold: payload.stats.threshold,
      windowMs: payload.stats.windowMs,
      sampleOrderIds: payload.stats.sampleOrderIds,
    },
  });
}

async function dispatchAll(
  payload: MachineMismatchAlertPayload,
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
      if (result.ok && !result.skipped) {
        lastMap[dc] = payload.now;
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[MachineMismatchAlerter] ${dc} ${payload.kind} failed:`,
        err,
      );
      return { channel: dc, ok: false, reason };
    }
  });
  const results = await Promise.all(promises);
  await Promise.all(results.map((r) => recordDeliveryAttempt(payload, r)));
  return results;
}

/**
 * Count the distinct Machine orders within the trailing window whose
 * granted product slugs disagree with their captured portal_product_keys.
 *
 * Mirrors the SQL behind the admin Integrations YSE page: join
 * `user_products` (one row per granted product) → `products` (for the
 * slug) → `webhook_logs` (for the captured `portal_product_keys`). We
 * aggregate the granted slugs per order and pull the latest non-null
 * portal_product_keys payload, then apply the same `computeOrderMismatch`
 * heuristic the admin UI uses so the alerter and the UI cannot disagree
 * on which orders are flagged.
 */
async function computeMismatchStats(now: number): Promise<MachineMismatchStats> {
  const config = await loadAlertConfig();
  const windowMs = config.windowHours * 60 * 60 * 1000;
  const threshold = config.threshold;
  const since = new Date(now - windowMs);

  type Row = {
    externalOrderId: string;
    grantedSlugs: string[] | null;
    portalProductKeys: unknown;
    mostRecentPurchasedAt: Date | null;
  };
  let rows: Row[] = [];
  let statsAvailable = true;
  try {
    const webhookExternalId = sql<string>`'machine_' || ${userProductsTable.externalOrderId}`;
    rows = (await db
      .select({
        externalOrderId: userProductsTable.externalOrderId,
        grantedSlugs: sql<string[]>`array_remove(array_agg(distinct ${productsTable.slug}), null)`,
        portalProductKeys: sql<unknown>`max((${webhookLogsTable.payload} -> 'metadata' -> 'portal_product_keys')::text)`,
        mostRecentPurchasedAt: sql<Date>`max(${userProductsTable.purchasedAt})`,
      })
      .from(userProductsTable)
      .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
      .leftJoin(
        webhookLogsTable,
        eq(webhookLogsTable.externalId, webhookExternalId),
      )
      .where(
        and(
          eq(userProductsTable.externalSource, "machine"),
          isNotNull(userProductsTable.externalOrderId),
          gte(userProductsTable.purchasedAt, since),
        ),
      )
      .groupBy(userProductsTable.externalOrderId)
      .orderBy(desc(sql`max(${userProductsTable.purchasedAt})`))) as Row[];
  } catch (err) {
    console.error("[MachineMismatchAlerter] mismatch-stats query failed:", err);
    statsAvailable = false;
    rows = [];
  }

  let total = 0;
  const sampleOrderIds: string[] = [];
  for (const row of rows) {
    const granted = Array.isArray(row.grantedSlugs) ? row.grantedSlugs : [];
    const portalKeys = parsePortalProductKeys(row.portalProductKeys);
    if (computeOrderMismatch("machine", granted, portalKeys)) {
      total += 1;
      if (sampleOrderIds.length < 5) {
        sampleOrderIds.push(row.externalOrderId);
      }
    }
  }

  return {
    total,
    windowMs,
    threshold,
    alerting: statsAvailable && total >= threshold,
    sampleOrderIds,
    statsAvailable,
  };
}

/**
 * Compute the mismatch stats and dispatch any state-transition alerts.
 *
 * The `stats` field is always populated so admin endpoints / dashboards
 * (future use) can render the same numbers the alerter just used. The
 * `deliveries` array is empty when the alerting state did not transition.
 */
export async function evaluateMachineMismatchAlert(
  now: number = Date.now(),
): Promise<MachineMismatchEvaluation> {
  const stats = await computeMismatchStats(now);
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

export function startMachineMismatchAlerter(): void {
  if (started) return;
  started = true;
  evaluateMachineMismatchAlert().catch((err) => {
    console.error("[MachineMismatchAlerter] startup error:", err);
  });
  if (POLL_MS > 0) {
    pollHandle = setInterval(() => {
      evaluateMachineMismatchAlert().catch((err) => {
        console.error("[MachineMismatchAlerter] poll error:", err);
      });
    }, POLL_MS);
    pollHandle.unref?.();
  }
}

export function stopMachineMismatchAlerter(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  started = false;
}
