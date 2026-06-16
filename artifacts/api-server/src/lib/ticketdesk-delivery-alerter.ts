/**
 * Pages on-call when TicketDesk ticket delivery keeps failing.
 *
 * Every member support ticket is mirrored to the external TicketDesk platform
 * via the BullMQ delivery queue (`ticketdesk-queue.ts`). If the TicketDesk
 * origin whitelist expires, the API secret rotates, or the TicketDesk instance
 * goes down, every retry fails and tickets pile up in
 * `delivery_status = 'failed'` (or never leave `'pending'`). Each individual
 * failure already triggers a fallback email to the support inbox, but a
 * sustained outage produces a quiet flood of those that nobody correlates
 * into "TicketDesk is down" until members start emailing directly.
 *
 * This alerter polls the live stuck-ticket count
 * (`getStuckTicketDeliveryStats`) and pages on-call once the backlog of
 * tickets stuck for longer than the configured age crosses a threshold. It
 * mirrors `rate-limit-audit-failure-alerter.ts` so on-call only ever has to
 * learn one alert pattern. Each delivery channel (PagerDuty / ops email /
 * Slack) is independently optional and configured via the same env vars used
 * by the other alerters:
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY   (Events API v2 routing key)
 *   - Ops email:  OPS_ALERT_EMAIL             (sent via SendGrid)
 *                 OPS_ALERT_FROM_EMAIL        (defaults to FROM_EMAIL or noreply@buildtestscale.com)
 *                 SENDGRID_API_KEY            (required for the email channel)
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL (incoming webhook URL)
 *
 * Behavior:
 *   - "fire" when the stuck-ticket backlog is at or above the threshold.
 *     Re-evaluations while still alerting also attempt dispatch so a
 *     sustained outage gets one page per throttle window (the per-channel
 *     throttle suppresses the rest) rather than spamming on-call.
 *   - "clear" (auto-resolve) the moment the backlog drains back below the
 *     threshold. Unlike the monotonic-counter alerters, the stuck count is a
 *     live DB query that naturally drops as the queue catches up or an admin
 *     fixes the root cause — so the backlog clearing IS the recovery signal,
 *     no quiet-window proxy needed.
 *   - PagerDuty incidents use a stable dedup_key
 *     (`ticketdesk-delivery:backlog`) so re-triggers fold into the existing
 *     incident and a "resolve" event auto-closes it.
 *
 * Thresholds are env-tunable (with sensible defaults) so a noisy environment
 * can raise the bar without a code change:
 *   - TICKETDESK_DELIVERY_BACKLOG_ALERT_THRESHOLD    (default 5)
 *   - TICKETDESK_DELIVERY_STUCK_MINUTES              (default 30)
 *   - TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS   (default 15 min)
 *   - TICKETDESK_DELIVERY_ALERTER_POLL_MS            (default 60s)
 */

import sgMail from "@sendgrid/mail";
import {
  getStuckTicketDeliveryStats,
  TICKETDESK_STUCK_MINUTES_DEFAULT,
  type StuckTicketDeliveryStats,
} from "./ticketdesk-queue";

type DeliveryChannel = "pagerduty" | "email" | "slack";
type AlertKind = "fire" | "clear";

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getStuckMinutes(): number {
  const raw = parseEnvInt(
    "TICKETDESK_DELIVERY_STUCK_MINUTES",
    TICKETDESK_STUCK_MINUTES_DEFAULT,
  );
  return raw > 0 ? raw : TICKETDESK_STUCK_MINUTES_DEFAULT;
}

function getAlertThreshold(): number {
  // Small by design: even a handful of tickets stuck past the cutoff means
  // delivery has been failing for half an hour, which is already worth a
  // page since each stuck ticket is a member request the team can't see in
  // TicketDesk. Configurable so a noisy environment can raise the bar.
  const raw = parseEnvInt("TICKETDESK_DELIVERY_BACKLOG_ALERT_THRESHOLD", 5);
  return raw > 0 ? raw : 5;
}

function getNotificationThrottleMs(): number {
  return parseEnvInt(
    "TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS",
    15 * 60 * 1000,
  );
}

const POLL_MS = parseEnvInt("TICKETDESK_DELIVERY_ALERTER_POLL_MS", 60 * 1000);

interface AlertState {
  /** True if we currently consider the delivery backlog "alerting". */
  alerting: boolean;
  /** Last stuck-ticket count observed by `evaluate`. */
  lastSeenCount: number;
  /** Per-delivery-channel timestamp of the last successful "fire" send. */
  lastFireAt: Partial<Record<DeliveryChannel, number>>;
  /** Per-delivery-channel timestamp of the last successful "clear" send. */
  lastClearAt: Partial<Record<DeliveryChannel, number>>;
}

const alertState: AlertState = {
  alerting: false,
  lastSeenCount: 0,
  lastFireAt: {},
  lastClearAt: {},
};

export interface TicketDeskDeliveryAlertPayload {
  kind: AlertKind;
  now: number;
  /** Threshold in force when the transition was detected. */
  threshold: number;
  /** Age (minutes) past which a ticket counts as stuck, in force at transition. */
  stuckMinutes: number;
  /** Snapshot of the stuck-ticket backlog at transition time. */
  stats: StuckTicketDeliveryStats;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  ok: boolean;
  /** True if no notification was attempted (provider not configured or throttled). */
  skipped?: boolean;
  reason?: string;
}

type DeliveryFn = (
  payload: TicketDeskDeliveryAlertPayload,
) => Promise<DeliveryResult>;

let sgMailInitialized = false;

function describeBacklog(stats: StuckTicketDeliveryStats): string {
  const parts: string[] = [];
  if (stats.byStatus.failed > 0) parts.push(`failed: ${stats.byStatus.failed}`);
  if (stats.byStatus.pending > 0) parts.push(`pending: ${stats.byStatus.pending}`);
  return parts.length > 0 ? parts.join("; ") : "(no breakdown)";
}

const defaultDeliveries: Record<DeliveryChannel, DeliveryFn> = {
  pagerduty: async (p) => {
    const key = process.env.PAGERDUTY_INTEGRATION_KEY;
    if (!key) {
      return {
        channel: "pagerduty",
        ok: true,
        skipped: true,
        reason: "not_configured",
      };
    }
    const dedupKey = "ticketdesk-delivery:backlog";
    const summary =
      p.kind === "fire"
        ? `TicketDesk delivery is failing — ${p.stats.count} ticket(s) stuck >${p.stuckMinutes}m (threshold ${p.threshold}); ${describeBacklog(p.stats)}`
        : "TicketDesk delivery backlog cleared";
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
              component: "ticketdesk-delivery",
              class: "ticketdesk_delivery_failure",
              custom_details: {
                threshold: p.threshold,
                stuckMinutes: p.stuckMinutes,
                stuckCount: p.stats.count,
                byStatus: p.stats.byStatus,
                oldestCreatedAt: p.stats.oldestCreatedAt,
                lastError: p.stats.lastError,
                link: "/admin/system",
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
    const to = process.env.OPS_ALERT_EMAIL;
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
    const subject =
      p.kind === "fire"
        ? "[ALERT] TicketDesk ticket delivery is failing"
        : "[RESOLVED] TicketDesk ticket delivery recovered";
    const text =
      p.kind === "fire"
        ? [
            `${p.stats.count} support ticket(s) have been stuck undelivered to TicketDesk for over ${p.stuckMinutes} minute(s),`,
            `crossing the configured threshold of ${p.threshold}.`,
            "",
            `Breakdown: ${describeBacklog(p.stats)}.`,
            "'failed' tickets exhausted all delivery retries; 'pending' tickets never left the queue.",
            "This usually means the TicketDesk origin whitelist expired, the API secret rotated, or the TicketDesk instance is down.",
            "",
            `Oldest stuck ticket created: ${p.stats.oldestCreatedAt ?? "n/a"}.`,
            `Last delivery error: ${p.stats.lastError ?? "no detail recorded"}.`,
            "",
            "Fallback emails for each failed/skipped ticket have gone to the support inbox, but delivery itself is broken.",
            "Open /admin/system and check the 'TicketDesk delivery' panel, then verify the TicketDesk whitelist/secret.",
          ].join("\n")
        : [
            "The TicketDesk delivery backlog has drained back below the alert threshold —",
            "stuck tickets are clearing. Marking the alert resolved.",
            "",
            `Tickets still stuck >${p.stuckMinutes}m: ${p.stats.count}.`,
            "Confirm via /admin/system.",
          ].join("\n");
    await sgMail.send({ to, from, subject, text });
    return { channel: "email", ok: true };
  },

  slack: async (p) => {
    const url = process.env.OPS_ALERT_SLACK_WEBHOOK_URL;
    if (!url) {
      return {
        channel: "slack",
        ok: true,
        skipped: true,
        reason: "not_configured",
      };
    }
    const text =
      p.kind === "fire"
        ? `:rotating_light: *TicketDesk ticket delivery is failing* — ${p.stats.count} ticket(s) stuck >${p.stuckMinutes}m (threshold ${p.threshold}). Breakdown: ${describeBacklog(p.stats)}. Check the TicketDesk whitelist/secret and /admin/system.`
        : `:white_check_mark: *TicketDesk delivery recovered* — backlog drained below threshold (${p.stats.count} still stuck).`;
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

type StatsReader = (
  stuckMinutes: number,
  now: Date,
) => Promise<StuckTicketDeliveryStats>;

let statsReaderOverride: StatsReader | null = null;

/** Test-only: replace one or more delivery functions with stubs. */
export function __setTicketDeskDeliveryAlerterDeliveriesForTests(
  overrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null,
): void {
  deliveryOverrides = overrides;
}

/** Test-only: replace the stuck-ticket stats reader (avoids hitting the DB). */
export function __setTicketDeskDeliveryStatsReaderForTests(
  reader: StatsReader | null,
): void {
  statsReaderOverride = reader;
}

/** Test-only: reset all alerter state. */
export function __resetTicketDeskDeliveryAlerterForTests(): void {
  alertState.alerting = false;
  alertState.lastSeenCount = 0;
  alertState.lastFireAt = {};
  alertState.lastClearAt = {};
  deliveryOverrides = null;
  statsReaderOverride = null;
}

async function dispatchAll(
  payload: TicketDeskDeliveryAlertPayload,
): Promise<DeliveryResult[]> {
  const lastMap =
    payload.kind === "fire" ? alertState.lastFireAt : alertState.lastClearAt;
  const promises: Promise<DeliveryResult>[] = (
    ["pagerduty", "email", "slack"] as const
  ).map(async (dc) => {
    const last = lastMap[dc] ?? 0;
    if (last > 0 && payload.now - last < getNotificationThrottleMs()) {
      return { channel: dc, ok: true, skipped: true, reason: "throttled" };
    }
    const fn = deliveryOverrides?.[dc] ?? defaultDeliveries[dc];
    try {
      const result = await fn(payload);
      // Only consume the throttle slot when something was actually sent — a
      // "skipped" (no provider configured) shouldn't gate the next attempt,
      // and a thrown error already returns ok:false below without burning the
      // slot either.
      if (result.ok && !result.skipped) {
        lastMap[dc] = payload.now;
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[TicketDeskDeliveryAlerter] ${dc} ${payload.kind} failed:`,
        err,
      );
      return { channel: dc, ok: false, reason };
    }
  });
  return Promise.all(promises);
}

/**
 * Read the current stuck-ticket backlog and dispatch any state-transition
 * alerts:
 *   - "fire" when the backlog is at or above the threshold (entering the
 *     alerting state, or sustained while still alerting — the throttle gates
 *     spam).
 *   - "clear" when, while alerting, the backlog has drained below the
 *     threshold.
 *
 * Safe to call frequently; transitions are gated by the `alerting` flag and
 * deliveries are throttled per channel. A DB read error degrades to a no-op
 * (logged) so a flaky DB can't itself flip the alert.
 */
export async function evaluateTicketDeskDeliveryAlert(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const stuckMinutes = getStuckMinutes();
  const threshold = getAlertThreshold();

  let stats: StuckTicketDeliveryStats;
  try {
    const reader = statsReaderOverride ?? getStuckTicketDeliveryStats;
    stats = await reader(stuckMinutes, new Date(now));
  } catch (err) {
    console.error(
      "[TicketDeskDeliveryAlerter] Failed to read stuck-ticket stats:",
      err,
    );
    return [];
  }
  alertState.lastSeenCount = stats.count;

  // Fire when the backlog is at or above the threshold. We attempt dispatch
  // both on the first transition into alerting AND while already alerting (so
  // a sustained outage gets one fire per throttle window, not just one per
  // outage). The per-channel throttle inside `dispatchAll` suppresses
  // re-fires within the window.
  if (stats.count >= threshold) {
    const wasAlerting = alertState.alerting;
    alertState.alerting = true;
    // On the transition INTO a fresh outage, clear the throttle markers so the
    // first page of the new incident always goes out — a throttle slot left
    // over from a prior incident (fire) or its recovery (clear) must never
    // suppress the opening page of a new one.
    if (!wasAlerting) {
      alertState.lastFireAt = {};
      alertState.lastClearAt = {};
    }
    return dispatchAll({ kind: "fire", now, threshold, stuckMinutes, stats });
  }

  // Auto-clear: we're alerting and the backlog has drained below the
  // threshold. The live count is the natural recovery signal.
  if (alertState.alerting) {
    alertState.alerting = false;
    // Clear the throttle markers on recovery for the same reason: the "clear"
    // notification, and the next incident's first "fire", must not be gated by
    // a slot consumed during the outage we're now resolving.
    alertState.lastFireAt = {};
    alertState.lastClearAt = {};
    return dispatchAll({ kind: "clear", now, threshold, stuckMinutes, stats });
  }

  return [];
}

/**
 * Public read-only view of the alerter's current state. Surfaced by the admin
 * System Health endpoint and notification bell so they can render "currently
 * paging" without re-deriving the transition logic.
 */
export function getTicketDeskDeliveryAlertingState(): {
  alerting: boolean;
  lastSeenCount: number;
} {
  return {
    alerting: alertState.alerting,
    lastSeenCount: alertState.lastSeenCount,
  };
}

let pollHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Run a startup check and start the recovery poll so a TicketDesk delivery
 * outage is detected even if no admin loads the dashboard and no request
 * happens to call `evaluate` from the route layer. Idempotent.
 */
export function startTicketDeskDeliveryAlerter(): void {
  if (started) return;
  started = true;
  evaluateTicketDeskDeliveryAlert().catch((err) => {
    console.error("[TicketDeskDeliveryAlerter] startup error:", err);
  });
  if (POLL_MS > 0) {
    pollHandle = setInterval(() => {
      evaluateTicketDeskDeliveryAlert().catch((err) => {
        console.error("[TicketDeskDeliveryAlerter] poll error:", err);
      });
    }, POLL_MS);
    pollHandle.unref?.();
  }
}

/** Stop the poll. */
export function stopTicketDeskDeliveryAlerter(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  started = false;
}
