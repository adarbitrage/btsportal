/**
 * Sends real on-call notifications when the signup CAPTCHA challenge is
 * silently disabled in production (i.e. `TURNSTILE_SECRET_KEY` is unset
 * while `NODE_ENV === "production"`).
 *
 * The PagerDuty / SendGrid / Slack delivery, the per-channel throttle, and
 * the SendGrid lazy init are all owned by `oncall-dispatcher.ts` — this
 * module only contributes the state-transition detector (was the challenge
 * enforced last time, is it enforced now?) and the alert title / message /
 * dedup key.
 *
 * Delivery channels are configured via env vars (matching the historical
 * behavior for this alerter):
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

import { isSignupChallengeEnforced } from "../middleware/captcha";
import {
  createInMemoryThrottleStore,
  createOnCallDispatcher,
  createPollRunner,
  parseEnvInt,
  type AlertKind,
  type AlertMessages,
  type DeliveryFn,
  type DeliveryChannel,
  type DeliveryResult,
  type OnCallDestinations,
} from "./oncall-dispatcher";

export type { DeliveryResult };

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

export interface SignupChallengeAlertPayload {
  kind: AlertKind;
  now: number;
}

const FIRE_SUMMARY =
  "Signup challenge disabled in production — TURNSTILE_SECRET_KEY is unset, signups bypass Cloudflare Turnstile";

function destinationsFromEnv(): OnCallDestinations {
  return {
    pagerdutyIntegrationKey: process.env.PAGERDUTY_INTEGRATION_KEY ?? null,
    opsAlertEmail: process.env.OPS_ALERT_EMAIL ?? null,
    opsAlertSlackWebhookUrl: process.env.OPS_ALERT_SLACK_WEBHOOK_URL ?? null,
  };
}

function buildMessages(p: SignupChallengeAlertPayload): AlertMessages {
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
  const slackText =
    p.kind === "fire"
      ? ":rotating_light: *Signup challenge disabled in production* — TURNSTILE_SECRET_KEY is not set on the API server, signups bypass Cloudflare Turnstile. Restore the secret to re-enable verification."
      : ":white_check_mark: *Signup challenge re-enabled in production* — TURNSTILE_SECRET_KEY is configured again.";
  return {
    pagerduty: {
      dedupKey: "signup-challenge:disabled",
      summary: FIRE_SUMMARY,
      severity: "error",
      component: "signup-challenge",
      class: "signup_challenge_disabled",
    },
    email: { subject, text },
    slack: { text: slackText },
  };
}

const throttleStore = createInMemoryThrottleStore();

const dispatcher = createOnCallDispatcher<
  SignupChallengeAlertPayload,
  string
>({
  name: "SignupChallengeAlerter",
  destinations: destinationsFromEnv,
  throttleMs: getNotificationThrottleMs,
  throttleStore,
  throttleKey: (p, dc) => `${p.kind}:${dc}`,
  buildMessages,
  kindOf: (p) => p.kind,
});

/** Test-only: replace one or more delivery functions with stubs. */
export function __setSignupChallengeAlerterDeliveriesForTests(
  overrides: Partial<
    Record<DeliveryChannel, DeliveryFn<SignupChallengeAlertPayload>>
  > | null,
): void {
  dispatcher.setDeliveryOverrides(overrides);
}

interface AlertingState {
  /** True if we currently consider the signup challenge "alerting". */
  alerting: boolean;
}

const alertingState: AlertingState = { alerting: false };

/** Test-only: reset all alerter state. */
export function __resetSignupChallengeAlerterForTests(): void {
  alertingState.alerting = false;
  throttleStore.reset();
  dispatcher.setDeliveryOverrides(null);
}

/**
 * Check the current state of the signup challenge in production and
 * dispatch any state-transition alerts (fire on first detection, clear when
 * the secret comes back). No-op outside production. Safe to call frequently;
 * transitions are gated by per-channel state and deliveries are throttled.
 *
 * Concurrency: the route-level dispatch is fire-and-forget while the
 * background poll runs every few minutes. Both call sites share
 * `alertingState.alerting`, so we flip the transition flag *before* awaiting
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
  const prev = alertingState.alerting;
  if (currentlyDisabled && !prev) {
    alertingState.alerting = true;
    return dispatcher.dispatch({ kind: "fire", now }, now);
  }
  if (!currentlyDisabled && prev) {
    alertingState.alerting = false;
    return dispatcher.dispatch({ kind: "clear", now }, now);
  }
  return [];
}

const runner = createPollRunner({
  name: "SignupChallengeAlerter",
  pollMs: POLL_MS,
  evaluate: () => evaluateSignupChallengeAlert(),
  startupEvaluate: true,
});

/**
 * Run a startup check and start the recovery poll so a misconfiguration is
 * detected even if no admin loads the dashboard. Idempotent.
 */
export function startSignupChallengeAlerter(): void {
  runner.start();
}

/** Stop the poll. */
export function stopSignupChallengeAlerter(): void {
  runner.stop();
}
