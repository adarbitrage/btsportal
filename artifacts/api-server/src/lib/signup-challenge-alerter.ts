/**
 * Sends real on-call notifications when the signup CAPTCHA challenge is
 * silently disabled in production (i.e. `TURNSTILE_SECRET_KEY` is unset
 * while `NODE_ENV === "production"`).
 *
 * Mirrors the queue-fallback alerter so on-call only ever has to learn one
 * pattern. Each delivery channel (PagerDuty / ops email / Slack) is
 * independently optional and configured via the same env vars used by the
 * queue-fallback alerter:
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY   (Events API v2 routing key)
 *   - Ops email:  OPS_ALERT_EMAIL             (sent via SendGrid)
 *                 OPS_ALERT_FROM_EMAIL        (defaults to FROM_EMAIL or noreply@buildtestscale.com)
 *                 SENDGRID_API_KEY            (required for the email channel)
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL (incoming webhook URL)
 *
 * Behavior:
 *   - When the challenge transitions from "enforced" to "disabled" in
 *     production, we send a single "fire" alert per delivery channel.
 *   - When it transitions back ("disabled" → "enforced"), we send an
 *     "all clear".
 *   - Each delivery channel is throttled to at most one notification per
 *     SIGNUP_CHALLENGE_NOTIFICATION_THROTTLE_MS (default 1 hour) so a
 *     bouncing config (e.g. someone toggling the secret) can't spam on-call.
 *   - PagerDuty incidents use a stable dedup_key
 *     (`signup-challenge:disabled`) so re-triggers fold into the existing
 *     incident and a "resolve" event auto-closes it.
 *   - Outside production the evaluator is a no-op — local dev and CI
 *     legitimately run without TURNSTILE_SECRET_KEY.
 */

import sgMail from "@sendgrid/mail";
import { isSignupChallengeEnforced } from "../middleware/captcha";

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
    "SIGNUP_CHALLENGE_NOTIFICATION_THROTTLE_MS",
    60 * 60 * 1000,
  );
}

const POLL_MS = parseEnvInt(
  "SIGNUP_CHALLENGE_ALERTER_POLL_MS",
  5 * 60 * 1000,
);

interface AlertState {
  /** True if we currently consider the signup challenge "alerting". */
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

export interface SignupChallengeAlertPayload {
  kind: AlertKind;
  now: number;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  ok: boolean;
  /** True if no notification was attempted (e.g. provider not configured or throttled). */
  skipped?: boolean;
  reason?: string;
}

type DeliveryFn = (
  payload: SignupChallengeAlertPayload,
) => Promise<DeliveryResult>;

let sgMailInitialized = false;

const FIRE_SUMMARY =
  "Signup challenge disabled in production — TURNSTILE_SECRET_KEY is unset, signups bypass Cloudflare Turnstile";

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
    const dedupKey = "signup-challenge:disabled";
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
              component: "signup-challenge",
              class: "signup_challenge_disabled",
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
        ? "[ALERT] Signup challenge disabled in production"
        : "[RESOLVED] Signup challenge re-enabled in production";
    const text =
      p.kind === "fire"
        ? [
            "TURNSTILE_SECRET_KEY is not set on the production API server.",
            "Signup requests are passing through without Cloudflare Turnstile verification,",
            "leaving the signup endpoint exposed to bots and credential-stuffing scripts.",
            "",
            "Restore TURNSTILE_SECRET_KEY on the API service and confirm via /admin/system.",
          ].join("\n")
        : [
            "The signup challenge is now enforced again on the production API server.",
            "TURNSTILE_SECRET_KEY is configured and verifying signup requests.",
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
        ? ":rotating_light: *Signup challenge disabled in production* — TURNSTILE_SECRET_KEY is not set on the API server, signups bypass Cloudflare Turnstile. Restore the secret to re-enable verification."
        : ":white_check_mark: *Signup challenge re-enabled in production* — TURNSTILE_SECRET_KEY is configured again.";
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
export function __setSignupChallengeAlerterDeliveriesForTests(
  overrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null,
): void {
  deliveryOverrides = overrides;
}

/** Test-only: reset all alerter state. */
export function __resetSignupChallengeAlerterForTests(): void {
  alertState.alerting = false;
  alertState.lastFireAt = {};
  alertState.lastClearAt = {};
  deliveryOverrides = null;
}

async function dispatchAll(
  payload: SignupChallengeAlertPayload,
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
        `[SignupChallengeAlerter] ${dc} ${payload.kind} failed:`,
        err,
      );
      return { channel: dc, ok: false, reason };
    }
  });
  return Promise.all(promises);
}

/**
 * Check the current state of the signup challenge in production and
 * dispatch any state-transition alerts (fire on first detection, clear when
 * the secret comes back). No-op outside production. Safe to call frequently;
 * transitions are gated by per-channel state and deliveries are throttled.
 *
 * Concurrency: the route-level dispatch is fire-and-forget while the
 * background poll runs every few minutes. Both call sites share
 * `alertState.alerting`, so we flip the transition flag *before* awaiting
 * the dispatch. Any concurrent call that arrives mid-dispatch sees the new
 * state and returns immediately instead of double-paging.
 */
export async function evaluateSignupChallengeAlert(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  if (process.env.NODE_ENV !== "production") {
    return [];
  }
  const enforced = isSignupChallengeEnforced();
  const currentlyDisabled = !enforced;
  const prev = alertState.alerting;
  if (currentlyDisabled && !prev) {
    alertState.alerting = true;
    return dispatchAll({ kind: "fire", now });
  }
  if (!currentlyDisabled && prev) {
    alertState.alerting = false;
    return dispatchAll({ kind: "clear", now });
  }
  return [];
}

let pollHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Run a startup check and start the recovery poll so a misconfiguration is
 * detected even if no admin loads the dashboard. Idempotent.
 */
export function startSignupChallengeAlerter(): void {
  if (started) return;
  started = true;
  evaluateSignupChallengeAlert().catch((err) => {
    console.error("[SignupChallengeAlerter] startup error:", err);
  });
  if (POLL_MS > 0) {
    pollHandle = setInterval(() => {
      evaluateSignupChallengeAlert().catch((err) => {
        console.error("[SignupChallengeAlerter] poll error:", err);
      });
    }, POLL_MS);
    pollHandle.unref?.();
  }
}

/** Stop the poll. */
export function stopSignupChallengeAlerter(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  started = false;
}
