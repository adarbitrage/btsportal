/**
 * Sends real on-call notifications when the recurring coaching-call auto
 * top-up job (see `coaching-call-template-topup.ts`) silently stops keeping
 * series populated. That job is the only thing extending every active
 * recurring template into the future — if its timer dies, or every run starts
 * throwing, the series quietly run dry again, which is the exact failure the
 * top-up feature was built to prevent. The System Health page surfaces the
 * "stale" state, but that signal only fires if an admin happens to look. This
 * alerter pages on-call so a stuck/erroring job is caught proactively.
 *
 * Mirrors `abuse-rate-limit-cleanup-alerter.ts` so on-call only ever has to
 * learn one alert pattern. Each delivery channel (PagerDuty / ops email /
 * Slack) is independently optional and configured via the same env vars used
 * by the other scheduled-sweep alerters:
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY   (Events API v2 routing key)
 *   - Ops email:  OPS_ALERT_EMAIL             (sent via SendGrid)
 *                 OPS_ALERT_FROM_EMAIL        (defaults to FROM_EMAIL or noreply@buildtestscale.com)
 *                 SENDGRID_API_KEY            (required for the email channel)
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL (incoming webhook URL)
 *
 * Behavior:
 *   - When the status transitions from "fresh" to "stale" — no successful
 *     sweep within 2× the run interval, which covers both "timer stopped" and
 *     "erroring every run" — we send a single "fire" alert per channel.
 *   - When it transitions back ("stale" -> "fresh"), we send an "all clear".
 *   - Each delivery channel is throttled to at most one notification per
 *     COACHING_CALL_TOPUP_NOTIFICATION_THROTTLE_MS (default 1 hour) so a
 *     flapping job cannot spam on-call.
 *   - PagerDuty incidents use a stable dedup_key
 *     (`coaching-call-template-topup:stale`) so re-triggers fold into the
 *     existing incident and a "resolve" event auto-closes it.
 *   - The fire body inspects `lastError` so on-call sees *why* the job is
 *     stale (timer not firing vs every template throwing) without opening
 *     System Health first.
 */

import sgMail from "@sendgrid/mail";
import { getCoachingCallTemplateTopUpHealth } from "./coaching-call-template-topup";

type DeliveryChannel = "pagerduty" | "email" | "slack";
type AlertKind = "fire" | "clear";

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getNotificationThrottleMs(): number {
  return parseEnvInt(
    "COACHING_CALL_TOPUP_NOTIFICATION_THROTTLE_MS",
    60 * 60 * 1000,
  );
}

// 15 minutes by default. The job's staleness threshold is 2× its (daily) run
// interval, so a sub-hour poll catches a stuck job promptly while adding
// negligible load.
const POLL_MS = parseEnvInt(
  "COACHING_CALL_TOPUP_ALERTER_POLL_MS",
  15 * 60 * 1000,
);

interface AlertState {
  /** True if we currently consider the top-up job "alerting" (stale). */
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

export interface CoachingCallTopUpAlertPayload {
  kind: AlertKind;
  now: number;
  /**
   * Snapshot of the top-up status at the moment the transition was detected.
   * Used to populate the alert body so on-call sees how long the job has been
   * silent and the last error (if any) without having to open System Health.
   */
  status: ReturnType<typeof getCoachingCallTemplateTopUpHealth>;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  ok: boolean;
  /** True if no notification was attempted (e.g. provider not configured or throttled). */
  skipped?: boolean;
  reason?: string;
}

type DeliveryFn = (
  payload: CoachingCallTopUpAlertPayload,
) => Promise<DeliveryResult>;

let sgMailInitialized = false;

const FIRE_SUMMARY =
  "Recurring coaching-call auto top-up is stale — no successful run in over 2× its interval, so active series are at risk of running dry";

function describeStatus(
  status: CoachingCallTopUpAlertPayload["status"],
): string {
  const parts: string[] = [];
  parts.push(`Last successful run: ${status.lastSuccessfulRunAt ?? "never"}`);
  parts.push(`Last run attempt: ${status.lastRanAt ?? "never"}`);
  if (status.lastError) {
    parts.push(
      `Last error: ${status.lastError.message} (at ${status.lastError.at})`,
    );
  }
  parts.push(`Run interval: ${Math.round(status.intervalMs / 60000)}m`);
  return parts.join(" \u2014 ");
}

// Distinguish the two failure modes for on-call: a run attempt landed more
// recently than the last success means the timer is firing but the sweep keeps
// erroring; otherwise the timer itself appears to have stopped.
function describeCause(status: CoachingCallTopUpAlertPayload["status"]): string {
  if (status.lastError) {
    return "the job is running but erroring every time";
  }
  return "the job's timer appears to have stopped firing";
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
    const dedupKey = "coaching-call-template-topup:stale";
    const body =
      p.kind === "fire"
        ? {
            routing_key: key,
            event_action: "trigger",
            dedup_key: dedupKey,
            payload: {
              summary: FIRE_SUMMARY,
              severity: "error",
              source: process.env.HOSTNAME ?? "api-server",
              component: "coaching-call-template-topup",
              class: "coaching_call_template_topup_stale",
              custom_details: {
                cause: describeCause(p.status),
                lastSuccessfulRunAt: p.status.lastSuccessfulRunAt,
                lastRanAt: p.status.lastRanAt,
                intervalMs: p.status.intervalMs,
                lastError: p.status.lastError,
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
        ? "[ALERT] Recurring coaching-call auto top-up is stale"
        : "[RESOLVED] Recurring coaching-call auto top-up recovered";
    const text =
      p.kind === "fire"
        ? [
            "The recurring coaching-call auto top-up job has not reported a successful run in over two run intervals.",
            `Likely cause: ${describeCause(p.status)}.`,
            "Active recurring series are no longer being extended into the future and will run dry once their generated weeks are used up.",
            "",
            describeStatus(p.status),
            "",
            "Open /admin/system and check the coaching-call top-up status.",
          ].join("\n")
        : [
            "The recurring coaching-call auto top-up job has reported a fresh successful run; the watchdog is no longer stale.",
            "",
            describeStatus(p.status),
            "",
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
    const lastSuccess = p.status.lastSuccessfulRunAt ?? "never";
    const text =
      p.kind === "fire"
        ? `:rotating_light: *Recurring coaching-call auto top-up is stale* — last successful run: ${lastSuccess} (${describeCause(p.status)}). Active series are at risk of running dry. Check /admin/system.`
        : `:white_check_mark: *Recurring coaching-call auto top-up recovered* — last successful run: ${lastSuccess}.`;
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
export function __setCoachingCallTopUpAlerterDeliveriesForTests(
  overrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null,
): void {
  deliveryOverrides = overrides;
}

/** Test-only: reset all alerter state. */
export function __resetCoachingCallTopUpAlerterForTests(): void {
  alertState.alerting = false;
  alertState.lastFireAt = {};
  alertState.lastClearAt = {};
  deliveryOverrides = null;
}

async function dispatchAll(
  payload: CoachingCallTopUpAlertPayload,
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
      // Only consume the throttle slot when something was actually sent —
      // a "skipped" (no provider configured) shouldn't gate the next attempt.
      if (result.ok && !result.skipped) {
        lastMap[dc] = payload.now;
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[CoachingCallTopUpAlerter] ${dc} ${payload.kind} failed:`,
        err,
      );
      return { channel: dc, ok: false, reason };
    }
  });
  return Promise.all(promises);
}

/**
 * Read the current top-up status and dispatch any state-transition alerts
 * (fire on first detection that the job has gone stale, clear when a fresh
 * successful run lands). Safe to call frequently; transitions are gated by the
 * `alerting` flag and deliveries are throttled.
 *
 * Concurrency: the background poll runs every few minutes and could in
 * principle overlap with a future on-demand evaluation. Both call sites share
 * `alertState.alerting`, so we flip the transition flag *before* awaiting
 * dispatch — any concurrent call that arrives mid-dispatch sees the new state
 * and returns immediately instead of double-paging.
 */
export async function evaluateCoachingCallTopUpAlert(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const status = getCoachingCallTemplateTopUpHealth();
  const currentlyStale = status.stale;
  const prev = alertState.alerting;
  if (currentlyStale && !prev) {
    alertState.alerting = true;
    return dispatchAll({ kind: "fire", now, status });
  }
  if (!currentlyStale && prev) {
    alertState.alerting = false;
    return dispatchAll({ kind: "clear", now, status });
  }
  return [];
}

let pollHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Run a startup check and start the recovery poll so a stuck top-up job is
 * detected even if no admin loads the dashboard. Idempotent.
 */
export function startCoachingCallTopUpAlerter(): void {
  if (started) return;
  started = true;
  evaluateCoachingCallTopUpAlert().catch((err) => {
    console.error("[CoachingCallTopUpAlerter] startup error:", err);
  });
  if (POLL_MS > 0) {
    pollHandle = setInterval(() => {
      evaluateCoachingCallTopUpAlert().catch((err) => {
        console.error("[CoachingCallTopUpAlerter] poll error:", err);
      });
    }, POLL_MS);
    pollHandle.unref?.();
  }
}

/** Stop the poll. */
export function stopCoachingCallTopUpAlerter(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  started = false;
}
