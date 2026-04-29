/**
 * Sends real on-call notifications when the email/SMS queue starts bypassing
 * Redis. Listens to queue-fallback-tracker events for fast "fire" alerts and
 * also polls periodically so it can detect "all clear" recovery (which is
 * passive — events simply age out of the recent window).
 *
 * Delivery channels (each independently optional, configured via env):
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY   (Events API v2 routing key)
 *   - Ops email:  OPS_ALERT_EMAIL             (sent via SendGrid)
 *                 OPS_ALERT_FROM_EMAIL        (defaults to FROM_EMAIL or noreply@buildtestscale.com)
 *                 SENDGRID_API_KEY            (required for the email channel)
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL (incoming webhook URL)
 *
 * Behavior:
 *   - When a queue channel (email/sms) transitions from "no recent fallbacks"
 *     to "has recent fallbacks", we send a "fire" alert on each configured
 *     delivery channel.
 *   - When the queue channel transitions back (no fallbacks within the
 *     recent window), we send an "all clear" alert.
 *   - Each delivery channel is throttled per queue-channel/per-kind to at
 *     most one notification per QUEUE_FALLBACK_NOTIFICATION_THROTTLE_MS
 *     (default 5 minutes), so a flapping outage cannot spam on-call.
 *   - PagerDuty incidents use a stable dedup_key (`queue-fallback:<channel>`)
 *     so re-triggers fold into the existing incident and a "resolve" event
 *     auto-closes it.
 */

import sgMail from "@sendgrid/mail";
import {
  getQueueFallbackStats,
  setQueueFallbackListener,
  type QueueChannel,
  type QueueFallbackStats,
} from "./queue-fallback-tracker";

type DeliveryChannel = "pagerduty" | "email" | "slack";
type AlertKind = "fire" | "clear";

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getNotificationThrottleMs(): number {
  return parseEnvInt("QUEUE_FALLBACK_NOTIFICATION_THROTTLE_MS", 5 * 60 * 1000);
}
const POLL_MS = parseEnvInt("QUEUE_FALLBACK_ALERTER_POLL_MS", 60 * 1000);

interface ChannelAlertState {
  /** True if we currently consider this queue channel "alerting". */
  alerting: boolean;
  /** Per-delivery-channel timestamp of the last successful "fire" send. */
  lastFireAt: Partial<Record<DeliveryChannel, number>>;
  /** Per-delivery-channel timestamp of the last successful "clear" send. */
  lastClearAt: Partial<Record<DeliveryChannel, number>>;
}

const alertState: Record<QueueChannel, ChannelAlertState> = {
  email: { alerting: false, lastFireAt: {}, lastClearAt: {} },
  sms: { alerting: false, lastFireAt: {}, lastClearAt: {} },
};

export interface AlertPayload {
  queueChannel: QueueChannel;
  kind: AlertKind;
  stats: QueueFallbackStats;
  now: number;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  ok: boolean;
  /** True if no notification was attempted (e.g. provider not configured or throttled). */
  skipped?: boolean;
  reason?: string;
}

type DeliveryFn = (payload: AlertPayload) => Promise<DeliveryResult>;

let sgMailInitialized = false;

const defaultDeliveries: Record<DeliveryChannel, DeliveryFn> = {
  pagerduty: async (p) => {
    const key = process.env.PAGERDUTY_INTEGRATION_KEY;
    if (!key) {
      return { channel: "pagerduty", ok: true, skipped: true, reason: "not_configured" };
    }
    const dedupKey = `queue-fallback:${p.queueChannel}`;
    const minutes = Math.round(p.stats.recentWindowMs / 60000);
    const recent = p.stats[p.queueChannel].recentCount;
    const body = p.kind === "fire"
      ? {
          routing_key: key,
          event_action: "trigger",
          dedup_key: dedupKey,
          payload: {
            summary: `${p.queueChannel.toUpperCase()} queue bypassing Redis — ${recent} direct-send fallback(s) in last ${minutes}m`,
            severity: "error",
            source: process.env.HOSTNAME ?? "api-server",
            component: "communication-queue",
            group: p.queueChannel,
            class: "queue_fallback",
            custom_details: p.stats,
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
      return { channel: "email", ok: true, skipped: true, reason: "not_configured" };
    }
    if (!process.env.SENDGRID_API_KEY) {
      return { channel: "email", ok: true, skipped: true, reason: "sendgrid_not_configured" };
    }
    if (!sgMailInitialized) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      sgMailInitialized = true;
    }
    const from =
      process.env.OPS_ALERT_FROM_EMAIL ??
      process.env.FROM_EMAIL ??
      "noreply@buildtestscale.com";
    const minutes = Math.round(p.stats.recentWindowMs / 60000);
    const ch = p.stats[p.queueChannel];
    const subject = p.kind === "fire"
      ? `[ALERT] ${p.queueChannel.toUpperCase()} queue is bypassing Redis`
      : `[RESOLVED] ${p.queueChannel.toUpperCase()} queue back to normal`;
    const text = p.kind === "fire"
      ? [
          `The ${p.queueChannel} queue had ${ch.recentCount} direct-send fallback(s) in the last ${minutes} minute(s).`,
          `Last fallback: ${ch.lastAt ?? "n/a"}`,
          `1h total: ${ch.hourCount}, 24h total: ${ch.dayCount}`,
          ``,
          `Check Redis health and the communication worker.`,
        ].join("\n")
      : [
          `The ${p.queueChannel} queue has had no direct-send fallbacks in the last ${minutes} minute(s).`,
          `24h total still on record: ${ch.dayCount}.`,
          ``,
          `Marking the alert resolved.`,
        ].join("\n");
    await sgMail.send({ to, from, subject, text });
    return { channel: "email", ok: true };
  },

  slack: async (p) => {
    const url = process.env.OPS_ALERT_SLACK_WEBHOOK_URL;
    if (!url) {
      return { channel: "slack", ok: true, skipped: true, reason: "not_configured" };
    }
    const minutes = Math.round(p.stats.recentWindowMs / 60000);
    const ch = p.stats[p.queueChannel];
    const text = p.kind === "fire"
      ? `:rotating_light: *${p.queueChannel.toUpperCase()} queue bypassing Redis* — ${ch.recentCount} direct-send fallback(s) in the last ${minutes}m. Last at ${ch.lastAt ?? "n/a"}. Check Redis.`
      : `:white_check_mark: *${p.queueChannel.toUpperCase()} queue recovered* — no fallbacks in the last ${minutes}m.`;
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

let deliveryOverrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null = null;

/** Test-only: replace one or more delivery functions with stubs. */
export function __setQueueFallbackAlerterDeliveriesForTests(
  overrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null,
): void {
  deliveryOverrides = overrides;
}

/** Test-only: reset all alerter state. */
export function __resetQueueFallbackAlerterForTests(): void {
  alertState.email = { alerting: false, lastFireAt: {}, lastClearAt: {} };
  alertState.sms = { alerting: false, lastFireAt: {}, lastClearAt: {} };
  deliveryOverrides = null;
}

async function dispatchAll(payload: AlertPayload): Promise<DeliveryResult[]> {
  const ch = alertState[payload.queueChannel];
  const lastMap = payload.kind === "fire" ? ch.lastFireAt : ch.lastClearAt;
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
      // Only consume the throttle slot when something was actually sent —
      // a "skipped" (no provider configured) shouldn't gate the next attempt.
      if (result.ok && !result.skipped) {
        lastMap[dc] = payload.now;
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[QueueFallbackAlerter] ${dc} ${payload.kind} for ${payload.queueChannel} failed:`,
        err,
      );
      return { channel: dc, ok: false, reason };
    }
  });
  return Promise.all(promises);
}

/**
 * Read the current fallback stats and dispatch any state-transition alerts
 * (fire on first event in the recent window, clear when the window empties).
 * Safe to call frequently; transitions are gated by per-channel state and
 * deliveries are throttled.
 */
export async function evaluateQueueFallbackAlerts(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const stats = getQueueFallbackStats();
  const all: DeliveryResult[] = [];
  for (const ch of ["email", "sms"] as const) {
    const currently = stats[ch].recentCount > 0;
    const prev = alertState[ch].alerting;
    if (currently && !prev) {
      const results = await dispatchAll({ queueChannel: ch, kind: "fire", stats, now });
      all.push(...results);
      alertState[ch].alerting = true;
    } else if (!currently && prev) {
      const results = await dispatchAll({ queueChannel: ch, kind: "clear", stats, now });
      all.push(...results);
      alertState[ch].alerting = false;
    }
  }
  return all;
}

let pollHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Wire the alerter into the tracker (so "fire" alerts dispatch within ms of
 * the first fallback) and start the recovery poll. Idempotent.
 */
export function startQueueFallbackAlerter(): void {
  if (started) return;
  started = true;
  setQueueFallbackListener(() => {
    evaluateQueueFallbackAlerts().catch((err) => {
      console.error("[QueueFallbackAlerter] dispatch error:", err);
    });
  });
  if (POLL_MS > 0) {
    pollHandle = setInterval(() => {
      evaluateQueueFallbackAlerts().catch((err) => {
        console.error("[QueueFallbackAlerter] poll error:", err);
      });
    }, POLL_MS);
    pollHandle.unref?.();
  }
}

/** Stop the poll and detach from the tracker. */
export function stopQueueFallbackAlerter(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  setQueueFallbackListener(null);
  started = false;
}
