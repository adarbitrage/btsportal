/**
 * Pages on-call when the Retell voice assistant agent is misconfigured.
 *
 * The voice agent's setup result is interpreted by
 * `interpretRetellSetupHealth` into a single verdict. When that verdict is
 * "misconfigured" the agent is configured-but-broken (e.g. RETELL_AGENT_ID
 * repointed to an agent that is NOT on the KB-connected retell-llm engine, a
 * substantial conversation-flow blocked the repoint, the function secret is
 * missing in production, or a manual re-run threw) and the voice assistant is
 * quietly giving wrong/empty answers. Until now that state was only visible if
 * an admin happened to open the System Health page. This alerter wires the
 * voice-agent "needsAttention" state into the same on-call destinations used by
 * the queue-fallback / TicketDesk-delivery / signup-challenge alerters so a
 * broken agent surfaces proactively.
 *
 * The PagerDuty / SendGrid / Slack delivery, the per-channel throttle, and the
 * SendGrid lazy init are all owned by `oncall-dispatcher.ts` — this module only
 * contributes the state-transition detector (was the agent healthy last time,
 * is it broken now?) and the alert title / message / dedup key.
 *
 * Delivery channels are configured via the same env vars as the other alerters:
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY   (Events API v2 routing key)
 *   - Ops email:  OPS_ALERT_EMAIL             (sent via SendGrid)
 *                 OPS_ALERT_FROM_EMAIL        (defaults to FROM_EMAIL or noreply@buildtestscale.com)
 *                 SENDGRID_API_KEY            (required for the email channel)
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL (incoming webhook URL)
 *
 * Behavior:
 *   - "fire" when the voice-agent verdict transitions to "misconfigured"
 *     (needsAttention true). Deliberately keyed off `needsAttention`, NOT the
 *     raw status, so "not_configured" (voice intentionally off, normal in dev)
 *     and "unknown" (still initializing) never page on-call.
 *   - "clear" (all clear) when the agent returns to a non-attention state
 *     (healthy again, or intentionally turned off).
 *   - Each delivery channel is throttled to at most one notification per
 *     RETELL_AGENT_NOTIFICATION_THROTTLE_MS (default 1 hour) so a bouncing
 *     config can't spam on-call.
 *   - PagerDuty incidents use a stable dedup_key (`retell-agent:misconfigured`)
 *     so re-triggers fold into the existing incident and a "resolve" event
 *     auto-closes it.
 */

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
import {
  getCachedRetellSetupResult,
  interpretRetellSetupHealth,
  type RetellHealthStatus,
} from "./retell-agent-setup";
import { logAuditEvent } from "./audit-log";

export type { DeliveryResult };

/**
 * Audit-log identifiers for the voice-assistant alerter's delivery rows.
 * `entityType` is the shared "alert" bucket every on-call alerter writes to,
 * so the System Health alert timeline can union them by `entityType="alert"`
 * + action type. `RETELL_AGENT_ALERT_ACTION_TYPE` is added to the timeline's
 * action-type allow-list in admin-panel.ts so these rows show up alongside the
 * queue-fallback / machine-mismatch deliveries.
 */
export const RETELL_AGENT_ALERT_ACTION_TYPE = "retell_agent_alert";
export const RETELL_AGENT_ALERT_ENTITY_TYPE = "alert";
export const RETELL_AGENT_ALERT_ENTITY_ID = "retell-voice-agent";

export type AlertDeliveryOutcome = "sent" | "failed" | "throttled" | "skipped";

function getNotificationThrottleMs(): number {
  return parseEnvInt("RETELL_AGENT_NOTIFICATION_THROTTLE_MS", 60 * 60 * 1000);
}

const POLL_MS = parseEnvInt("RETELL_AGENT_ALERTER_POLL_MS", 5 * 60 * 1000);

export interface RetellAgentAlertPayload {
  kind: AlertKind;
  now: number;
  /** Voice-agent verdict status at transition time. */
  status: RetellHealthStatus;
  /** Human-readable explanation from the setup result. */
  detail: string;
}

function destinationsFromEnv(): OnCallDestinations {
  return {
    pagerdutyIntegrationKey: process.env.PAGERDUTY_INTEGRATION_KEY ?? null,
    opsAlertEmail: process.env.OPS_ALERT_EMAIL ?? null,
    opsAlertSlackWebhookUrl: process.env.OPS_ALERT_SLACK_WEBHOOK_URL ?? null,
  };
}

function buildMessages(p: RetellAgentAlertPayload): AlertMessages {
  const subject =
    p.kind === "fire"
      ? "[ALERT] Voice assistant agent is misconfigured"
      : "[RESOLVED] Voice assistant agent recovered";
  const text =
    p.kind === "fire"
      ? [
          "The Retell voice assistant agent is configured but broken — it is no longer",
          "wired to the knowledge-base-connected retell-llm engine, so it may be",
          "answering members with wrong or empty responses.",
          "",
          `Detail: ${p.detail}`,
          "",
          "Common causes: RETELL_AGENT_ID was repointed to an agent on the wrong engine,",
          "a substantial conversation-flow blocked the auto-repoint, RETELL_FUNCTION_SECRET",
          "is missing in production, or a new agent was created and RETELL_AGENT_ID still",
          "points at the old one.",
          "",
          "Open /admin/system and check the 'Voice assistant' panel.",
        ].join("\n")
      : [
          "The Retell voice assistant agent is healthy again — it is wired to the",
          "knowledge-base-connected retell-llm engine (or has been intentionally turned",
          "off). Marking the alert resolved.",
          "",
          `Detail: ${p.detail}`,
        ].join("\n");
  const slackText =
    p.kind === "fire"
      ? `:rotating_light: *Voice assistant agent is misconfigured* — the Retell agent is configured but broken and may be answering members with wrong/empty responses. ${p.detail} Check /admin/system.`
      : `:white_check_mark: *Voice assistant agent recovered* — the Retell agent is healthy again. ${p.detail}`;
  return {
    pagerduty: {
      dedupKey: "retell-agent:misconfigured",
      summary: `Voice assistant agent is misconfigured — ${p.detail}`,
      severity: "error",
      component: "retell-voice-agent",
      class: "retell_agent_misconfigured",
      custom_details: {
        status: p.status,
        detail: p.detail,
        link: "/admin/system",
      },
    },
    email: { subject, text },
    slack: { text: slackText },
  };
}

function classifyOutcome(result: DeliveryResult): AlertDeliveryOutcome {
  if (!result.ok) return "failed";
  if (result.skipped) {
    return result.reason === "throttled" ? "throttled" : "skipped";
  }
  return "sent";
}

function describeAttempt(
  payload: RetellAgentAlertPayload,
  result: DeliveryResult,
  outcome: AlertDeliveryOutcome,
): string {
  const verb = payload.kind === "fire" ? "fire" : "clear";
  const reasonSuffix = result.reason ? ` (${result.reason})` : "";
  switch (outcome) {
    case "sent":
      return `Sent ${verb} alert via ${result.channel} for voice assistant agent`;
    case "failed":
      return `Failed to send ${verb} alert via ${result.channel} for voice assistant agent${reasonSuffix}`;
    case "throttled":
      return `Throttled ${verb} alert via ${result.channel} for voice assistant agent${reasonSuffix}`;
    case "skipped":
      return `Skipped ${verb} alert via ${result.channel} for voice assistant agent${reasonSuffix}`;
  }
}

/**
 * Persist a single delivery attempt as an audit-log row so the System Health
 * alert timeline (which unions every `entityType="alert"` action type) can show
 * when the voice agent went bad and recovered alongside the other alerters.
 * Fire-and-forget — `logAuditEvent` swallows DB errors so a flaky audit table
 * can never break alert dispatch.
 */
async function recordDeliveryAttempt(
  payload: RetellAgentAlertPayload,
  result: DeliveryResult,
): Promise<void> {
  const outcome = classifyOutcome(result);
  await logAuditEvent({
    actionType: RETELL_AGENT_ALERT_ACTION_TYPE,
    entityType: RETELL_AGENT_ALERT_ENTITY_TYPE,
    entityId: RETELL_AGENT_ALERT_ENTITY_ID,
    description: describeAttempt(payload, result, outcome),
    metadata: {
      deliveryChannel: result.channel,
      kind: payload.kind,
      outcome,
      reason: result.reason ?? null,
      status: payload.status,
      detail: payload.detail,
    },
  });
}

const throttleStore = createInMemoryThrottleStore();

const dispatcher = createOnCallDispatcher<RetellAgentAlertPayload, string>({
  name: "RetellAgentAlerter",
  destinations: destinationsFromEnv,
  throttleMs: getNotificationThrottleMs,
  throttleStore,
  throttleKey: (p, dc) => `${p.kind}:${dc}`,
  buildMessages,
  kindOf: (p) => p.kind,
  onDelivery: recordDeliveryAttempt,
});

/** Test-only: replace one or more delivery functions with stubs. */
export function __setRetellAgentAlerterDeliveriesForTests(
  overrides: Partial<
    Record<DeliveryChannel, DeliveryFn<RetellAgentAlertPayload>>
  > | null,
): void {
  dispatcher.setDeliveryOverrides(overrides);
}

interface AlertingState {
  /** True if we currently consider the voice agent "alerting" (misconfigured). */
  alerting: boolean;
}

const alertingState: AlertingState = { alerting: false };

/** Test-only: reset all alerter state. */
export function __resetRetellAgentAlerterForTests(): void {
  alertingState.alerting = false;
  throttleStore.reset();
  dispatcher.setDeliveryOverrides(null);
}

/**
 * Read the current voice-agent verdict and dispatch any state-transition
 * alerts (fire when it becomes misconfigured, clear when it recovers). Safe to
 * call frequently; transitions are gated by `alertingState.alerting` and
 * deliveries are throttled per channel.
 *
 * Concurrency: mirrors the signup-challenge alerter — the transition flag is
 * flipped synchronously *before* awaiting the dispatch, so a route-level
 * fire-and-forget call racing the background poll can't double-page.
 */
export async function evaluateRetellAgentAlert(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const verdict = interpretRetellSetupHealth(getCachedRetellSetupResult());
  const currentlyBroken = verdict.needsAttention;
  const prev = alertingState.alerting;
  if (currentlyBroken && !prev) {
    alertingState.alerting = true;
    return dispatcher.dispatch(
      { kind: "fire", now, status: verdict.status, detail: verdict.detail },
      now,
    );
  }
  if (!currentlyBroken && prev) {
    alertingState.alerting = false;
    return dispatcher.dispatch(
      { kind: "clear", now, status: verdict.status, detail: verdict.detail },
      now,
    );
  }
  return [];
}

/**
 * Public read-only view of the alerter's current state. Surfaced by the admin
 * System Health endpoint so it can render "currently paging" without
 * re-deriving the transition logic.
 */
export function getRetellAgentAlertingState(): { alerting: boolean } {
  return { alerting: alertingState.alerting };
}

const runner = createPollRunner({
  name: "RetellAgentAlerter",
  pollMs: POLL_MS,
  evaluate: () => evaluateRetellAgentAlert(),
  startupEvaluate: true,
});

/**
 * Run a startup check and start the recovery poll so a misconfigured voice
 * agent is detected even if no admin loads the dashboard. Idempotent.
 */
export function startRetellAgentAlerter(): void {
  runner.start();
}

/** Stop the poll. */
export function stopRetellAgentAlerter(): void {
  runner.stop();
}
