/**
 * Pages on-call when the scheduled-comms dedup store (`comms_send_log`)
 * starts failing repeatedly. The tracker (`comms-dedup-failure-tracker.ts`)
 * counts every "error" outcome from `reserveSend`; this alerter runs the
 * rolling-window threshold check and dispatches a single page per channel
 * per throttle window when failures exceed the configured limit.
 *
 * Why this matters: when the dedup store is broken, `reserveSend` skips the
 * send (to avoid uncontrolled double-sends every 15 minutes) — which means
 * mentorship-expiry, post-call feedback, and announcement emails are being
 * silently SUPPRESSED. Task #963 made that observable in the logs; this
 * alerter makes it page someone so a real outage is caught in minutes
 * instead of hours.
 *
 * Mirrors `moderation/failure-alerter.ts` and
 * `abuse-rate-limit-cleanup-alerter.ts` so on-call only has to learn one
 * alert pattern. Each delivery channel (PagerDuty / ops email / Slack) is
 * independently optional and uses the same env vars as the other alerters:
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY
 *   - Ops email:  OPS_ALERT_EMAIL (sent via SendGrid)
 *                 OPS_ALERT_FROM_EMAIL (defaults to FROM_EMAIL or noreply@buildtestscale.com)
 *                 SENDGRID_API_KEY
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL
 *
 * Threshold + window are env-tunable with sane defaults:
 *   - COMMS_DEDUP_FAILURE_ALERT_THRESHOLD            (default 3)
 *   - COMMS_DEDUP_FAILURE_ALERT_WINDOW_MS            (default 15 min — the scheduler cadence)
 *   - COMMS_DEDUP_FAILURE_NOTIFICATION_THROTTLE_MS   (default 15 min)
 *   - COMMS_DEDUP_FAILURE_RECOVERY_WINDOW_MS         (default 10 min)
 *   - COMMS_DEDUP_FAILURE_ALERTER_POLL_MS            (default 60s)
 *
 * State machine (same as the moderation alerter):
 *   - Fire when the rolling-window failure count crosses the threshold.
 *     Re-fire attempts while still alerting are suppressed by the per-channel
 *     throttle so a sustained outage produces one page per window.
 *   - Clear when no new failures arrive for the recovery window. The tracker's
 *     lazy-prune means the rolling window naturally drops back below threshold.
 *   - PagerDuty incidents use a stable dedup_key so re-triggers fold into the
 *     existing incident and the resolve event auto-closes it.
 */

import { gatedSendEmail } from "./email-transport";
import {
  getCommsDedupFailuresInWindow,
  getCommsDedupFailureCumulativeStats,
  type CommsDedupFailureWindowStats,
  type CommsDedupFailureCumulativeStats,
} from "./comms-dedup-failure-tracker";

type DeliveryChannel = "pagerduty" | "email" | "slack";
type AlertKind = "fire" | "clear";

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getThreshold(): number {
  // Minimum 1 — a threshold of 0 would page on an empty window forever.
  return Math.max(1, parseEnvInt("COMMS_DEDUP_FAILURE_ALERT_THRESHOLD", 3));
}

function getWindowMs(): number {
  return parseEnvInt("COMMS_DEDUP_FAILURE_ALERT_WINDOW_MS", 15 * 60 * 1000);
}

function getNotificationThrottleMs(): number {
  return parseEnvInt(
    "COMMS_DEDUP_FAILURE_NOTIFICATION_THROTTLE_MS",
    15 * 60 * 1000,
  );
}

function getRecoveryWindowMs(): number {
  return parseEnvInt("COMMS_DEDUP_FAILURE_RECOVERY_WINDOW_MS", 10 * 60 * 1000);
}

const POLL_MS = parseEnvInt("COMMS_DEDUP_FAILURE_ALERTER_POLL_MS", 60 * 1000);

interface AlertState {
  alerting: boolean;
  /** Last in-window total observed by `evaluate`. */
  lastSeenWindowTotal: number;
  /** Wall-clock time we last observed an in-window failure (for recovery). */
  lastInWindowFailureAt: number | null;
  lastFireAt: Partial<Record<DeliveryChannel, number>>;
  lastClearAt: Partial<Record<DeliveryChannel, number>>;
}

const alertState: AlertState = {
  alerting: false,
  lastSeenWindowTotal: 0,
  lastInWindowFailureAt: null,
  lastFireAt: {},
  lastClearAt: {},
};

export interface CommsDedupFailureAlertPayload {
  kind: AlertKind;
  now: number;
  /** Threshold that was in force when the transition was detected. */
  threshold: number;
  /** Window length (ms) that was in force when the transition was detected. */
  windowMs: number;
  /** Snapshot of failures inside the rolling window at transition time. */
  window: CommsDedupFailureWindowStats;
  /** Cumulative failures since process start. */
  cumulative: CommsDedupFailureCumulativeStats;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

type DeliveryFn = (
  payload: CommsDedupFailureAlertPayload,
) => Promise<DeliveryResult>;

function describeChannelBreakdown(window: CommsDedupFailureWindowStats): string {
  const parts: string[] = [];
  for (const [channel, count] of Object.entries(window.byChannel)) {
    if (count > 0) parts.push(`${channel}: ${count}`);
  }
  return parts.length > 0 ? parts.join("; ") : "(no in-window breakdown)";
}

const defaultDeliveries: Record<DeliveryChannel, DeliveryFn> = {
  pagerduty: async (p) => {
    const key = process.env.PAGERDUTY_INTEGRATION_KEY;
    if (!key) {
      return { channel: "pagerduty", ok: true, skipped: true, reason: "not_configured" };
    }
    const dedupKey = "comms-dedup-failure:suppressing";
    const minutes = Math.round(p.windowMs / 60000);
    const summary =
      p.kind === "fire"
        ? `Scheduled email dedup store failing — ${p.window.totalCount} failure(s) in the last ${minutes}m (threshold ${p.threshold}); scheduled emails are being SUPPRESSED. ${describeChannelBreakdown(p.window)}`
        : "Scheduled email dedup store recovered";
    const body =
      p.kind === "fire"
        ? {
            routing_key: key,
            event_action: "trigger",
            dedup_key: dedupKey,
            payload: {
              summary,
              severity: "critical",
              source: process.env.HOSTNAME ?? "api-server",
              component: "scheduled-comms",
              class: "comms_dedup_store_failure",
              custom_details: {
                threshold: p.threshold,
                windowMinutes: minutes,
                window: p.window,
                cumulative: p.cumulative,
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
      return { channel: "email", ok: true, skipped: true, reason: "not_configured" };
    }
    if (!process.env.SENDGRID_API_KEY) {
      return { channel: "email", ok: true, skipped: true, reason: "sendgrid_not_configured" };
    }
    const from =
      process.env.OPS_ALERT_FROM_EMAIL ??
      process.env.FROM_EMAIL ??
      "noreply@buildtestscale.com";
    const minutes = Math.round(p.windowMs / 60000);
    const subject =
      p.kind === "fire"
        ? "[ALERT] Scheduled emails are being silently suppressed"
        : "[RESOLVED] Scheduled email dedup store recovered";
    const text =
      p.kind === "fire"
        ? [
            `The scheduled-comms dedup store (comms_send_log) has failed ${p.window.totalCount} time(s) in the last ${minutes} minute(s),`,
            `crossing the configured threshold of ${p.threshold}.`,
            "",
            "While the dedup store is unavailable, the scheduler SKIPS every affected send to avoid uncontrolled double-sends.",
            "That means mentorship-expiry, post-call feedback, and announcement emails are being silently suppressed.",
            "",
            `In-window breakdown: ${describeChannelBreakdown(p.window)}.`,
            `Most recent failure: ${p.window.lastAt ?? "n/a"} — ${p.window.lastContext ?? "no detail"}.`,
            `Cumulative since process start: ${p.cumulative.totalCount}.`,
            "",
            "Investigate the comms_send_log table / database, then open /admin/system.",
          ].join("\n")
        : [
            "The scheduled-comms dedup store has been quiet for the recovery window —",
            "no new failures observed. Marking the alert resolved.",
            "",
            `Cumulative since process start: ${p.cumulative.totalCount}.`,
            "Confirm via /admin/system.",
          ].join("\n");
    await gatedSendEmail({ to, from, subject, text });
    return { channel: "email", ok: true };
  },

  slack: async (p) => {
    const url = process.env.OPS_ALERT_SLACK_WEBHOOK_URL;
    if (!url) {
      return { channel: "slack", ok: true, skipped: true, reason: "not_configured" };
    }
    const minutes = Math.round(p.windowMs / 60000);
    const text =
      p.kind === "fire"
        ? `:rotating_light: *Scheduled emails are being suppressed* — the dedup store failed ${p.window.totalCount} time(s) in the last ${minutes}m (threshold ${p.threshold}). Breakdown: ${describeChannelBreakdown(p.window)}. Mentorship-expiry / feedback / announcement emails are being skipped. Check /admin/system.`
        : `:white_check_mark: *Scheduled email dedup store recovered* — no new failures in the last few minutes. Cumulative since start: ${p.cumulative.totalCount}.`;
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

export function __setCommsDedupFailureAlerterDeliveriesForTests(
  overrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null,
): void {
  deliveryOverrides = overrides;
}

export function __resetCommsDedupFailureAlerterForTests(): void {
  alertState.alerting = false;
  alertState.lastSeenWindowTotal = 0;
  alertState.lastInWindowFailureAt = null;
  alertState.lastFireAt = {};
  alertState.lastClearAt = {};
  deliveryOverrides = null;
}

async function dispatchAll(
  payload: CommsDedupFailureAlertPayload,
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
      // "skipped" (no provider configured) shouldn't gate the next attempt.
      if (result.ok && !result.skipped) {
        lastMap[dc] = payload.now;
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[CommsDedupFailureAlerter] ${dc} ${payload.kind} failed:`,
        err,
      );
      return { channel: dc, ok: false, reason };
    }
  });
  return Promise.all(promises);
}

/**
 * Read the current rolling-window failure stats and dispatch any
 * state-transition alerts. Safe to call frequently — transitions are gated by
 * the `alerting` flag and deliveries are throttled per channel.
 */
export async function evaluateCommsDedupFailureAlert(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const threshold = getThreshold();
  const windowMs = getWindowMs();
  const window = getCommsDedupFailuresInWindow(windowMs, now);
  const cumulative = getCommsDedupFailureCumulativeStats();

  if (window.totalCount > alertState.lastSeenWindowTotal) {
    alertState.lastInWindowFailureAt = now;
  }
  alertState.lastSeenWindowTotal = window.totalCount;

  // Fire when the rolling window is at or above threshold. Re-evaluations
  // while still alerting also call dispatch so a sustained outage gets one
  // page per throttle window (the per-channel throttle suppresses the rest).
  if (window.totalCount >= threshold) {
    alertState.alerting = true;
    return dispatchAll({ kind: "fire", now, threshold, windowMs, window, cumulative });
  }

  // Auto-clear: we're alerting, the window has dropped back below threshold,
  // AND no new failures have arrived for the recovery window. The dual check
  // matters because a slow trickle could keep the window total just under
  // threshold — without the quiet-time check we'd resolve while failures are
  // still happening.
  const quietFor =
    alertState.lastInWindowFailureAt !== null
      ? now - alertState.lastInWindowFailureAt
      : Infinity;
  if (alertState.alerting && quietFor >= getRecoveryWindowMs()) {
    alertState.alerting = false;
    return dispatchAll({ kind: "clear", now, threshold, windowMs, window, cumulative });
  }

  return [];
}

/**
 * Public read-only view of the alerter's current state. Surfaced by the
 * admin System Health endpoint so the page can render "currently paging"
 * without re-deriving the transition logic.
 */
export function getCommsDedupFailureAlertingState(): {
  alerting: boolean;
  lastSeenWindowTotal: number;
  lastInWindowFailureAt: string | null;
} {
  return {
    alerting: alertState.alerting,
    lastSeenWindowTotal: alertState.lastSeenWindowTotal,
    lastInWindowFailureAt:
      alertState.lastInWindowFailureAt !== null
        ? new Date(alertState.lastInWindowFailureAt).toISOString()
        : null,
  };
}

let pollHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Run a startup check and start the recovery poll so a stuck dedup store is
 * detected even if no admin loads the dashboard. Idempotent. The scheduler
 * also evaluates at the end of each run for an immediate page; this poll is
 * the backstop that drives the recovery/clear transition forward.
 */
export function startCommsDedupFailureAlerter(): void {
  if (started) return;
  started = true;
  evaluateCommsDedupFailureAlert().catch((err) => {
    console.error("[CommsDedupFailureAlerter] startup error:", err);
  });
  if (POLL_MS > 0) {
    pollHandle = setInterval(() => {
      evaluateCommsDedupFailureAlert().catch((err) => {
        console.error("[CommsDedupFailureAlerter] poll error:", err);
      });
    }, POLL_MS);
    pollHandle.unref?.();
  }
}

/** Stop the poll. */
export function stopCommsDedupFailureAlerter(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  started = false;
}
