/**
 * Production env guard — pages on-call when production-critical secrets are
 * unset/defaulted.
 *
 * The signup-challenge alerter does the same thing for `TURNSTILE_SECRET_KEY`,
 * but several other secrets have the same silent-misconfiguration risk:
 *
 *   - `JWT_SECRET` falling back to the well-known `"dev-secret-change-me"`
 *     literal would let anyone forge access tokens.
 *   - `SESSION_SECRET` unset breaks long-lived session security.
 *   - `SENDGRID_API_KEY` unset silently drops verification and ops emails.
 *
 * Today admins only find out by accident. This module:
 *
 *   - Centralizes the list of guarded secrets — adding a new one is a
 *     one-line entry in `GUARDED_SECRETS`.
 *   - Surfaces each currently-misconfigured secret as a high-severity
 *     `/api/admin/notifications` item linking to `/admin/system`.
 *   - Fans out to the same on-call delivery channels as the queue-fallback
 *     and signup-challenge alerters (PagerDuty / ops email / Slack), with
 *     per-secret PagerDuty dedup keys and the existing per-channel,
 *     per-secret throttle so a bouncing config can't spam on-call.
 *
 * Outside production this module is a no-op — local dev and CI legitimately
 * run without these secrets.
 *
 * Delivery channels are configured via env vars (matching the historical
 * behavior for this guard):
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY   (Events API v2 routing key)
 *   - Ops email:  OPS_ALERT_EMAIL             (sent via SendGrid)
 *                 OPS_ALERT_FROM_EMAIL        (defaults to FROM_EMAIL or noreply@buildtestscale.com)
 *                 SENDGRID_API_KEY            (required for the email channel)
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL (incoming webhook URL)
 *
 * The throttle window defaults to 1 hour and can be overridden with
 * `PRODUCTION_ENV_GUARD_NOTIFICATION_THROTTLE_MS`.
 *
 * The background poll cadence defaults to 5 minutes and can be overridden
 * with `PRODUCTION_ENV_GUARD_POLL_MS`.
 *
 * Delivery, throttling, and SendGrid lazy init are owned by the shared
 * `oncall-dispatcher.ts` so this module only has to describe what to detect
 * and what to say.
 */

import {
  __resetSendGridInitForTests,
  createInMemoryThrottleStore,
  createOnCallDispatcher,
  createPollRunner,
  parseEnvInt,
  type AlertKind,
  type AlertMessages,
  type DeliveryFn,
  type DeliveryChannel,
  type DeliveryResult as BaseDeliveryResult,
  type OnCallDestinations,
} from "./oncall-dispatcher";

/**
 * A production secret that the env guard watches.
 *
 * Adding a new secret is intentionally a single entry in `GUARDED_SECRETS`
 * below — the dispatch, throttle, notification, and on-call routing all
 * key off this descriptor.
 */
export interface GuardedSecret {
  /** Stable identifier — drives notification id and PagerDuty dedup_key. */
  id: string;
  /** Env var name surfaced in messages and PagerDuty payloads. */
  envVar: string;
  /** Short notification + alert title. */
  title: string;
  /** Long-form description of the impact and how to remediate. */
  message: string;
  /**
   * Optional list of well-known placeholder values that should be treated
   * as "missing" (e.g. `dev-secret-change-me`). Compared after trimming.
   */
  defaultedValues?: readonly string[];
}

/**
 * The full list of guarded production secrets. Adding a new one is a
 * one-line entry here. Anything in this list is automatically:
 *   - reported via `/api/admin/notifications`
 *   - faned out to on-call on first-detection / cleared on recovery
 *   - deduped on PagerDuty by `production-env-guard:<id>`
 */
export const GUARDED_SECRETS: readonly GuardedSecret[] = [
  {
    id: "jwt-secret-missing",
    envVar: "JWT_SECRET",
    title: "JWT_SECRET unset or defaulted in production",
    message:
      "JWT_SECRET is not set on the production API server, or is using the well-known 'dev-secret-change-me' default. Access tokens can be forged. Set a strong JWT_SECRET on the API service immediately and rotate any tokens that may have been issued under the default.",
    defaultedValues: ["dev-secret-change-me"],
  },
  {
    id: "session-secret-missing",
    envVar: "SESSION_SECRET",
    title: "SESSION_SECRET unset in production",
    message:
      "SESSION_SECRET is not set on the production API server. Session-derived secrets fall back to insecure defaults, weakening session integrity. Set SESSION_SECRET on the API service.",
  },
  {
    id: "sendgrid-api-key-missing",
    envVar: "SENDGRID_API_KEY",
    title: "SENDGRID_API_KEY unset in production",
    message:
      "SENDGRID_API_KEY is not set on the production API server. Verification, password-reset, and operational alert emails are silently failing. Set SENDGRID_API_KEY on the API service to restore email delivery.",
  },
];

function getNotificationThrottleMs(): number {
  return parseEnvInt(
    "PRODUCTION_ENV_GUARD_NOTIFICATION_THROTTLE_MS",
    60 * 60 * 1000,
  );
}

const POLL_MS = parseEnvInt("PRODUCTION_ENV_GUARD_POLL_MS", 5 * 60 * 1000);

/**
 * How a guarded secret is misconfigured:
 *   - `"unset"`     — env var is not set, empty, or whitespace-only.
 *   - `"defaulted"` — env var is set but matches one of the known
 *                     placeholder defaults declared on the descriptor.
 *
 * The distinction matters for on-call: a defaulted JWT_SECRET means
 * tokens may have been forged with the well-known default and must be
 * rotated, while an unset one just needs the env var configured.
 */
export type SecretMisconfigurationState = "unset" | "defaulted";

/**
 * Returns the misconfiguration state for a guarded secret, or `null`
 * when it is configured to a non-placeholder value. The offending value
 * itself is intentionally never returned — callers (admin endpoints,
 * notifications) get only the categorical state.
 */
export function getSecretMisconfigurationState(
  secret: GuardedSecret,
): SecretMisconfigurationState | null {
  const raw = process.env[secret.envVar];
  if (typeof raw !== "string") return "unset";
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "unset";
  if (secret.defaultedValues && secret.defaultedValues.includes(trimmed)) {
    return "defaulted";
  }
  return null;
}

/**
 * Returns true when the secret should be considered misconfigured: unset,
 * empty/whitespace, or matching one of the known placeholder defaults.
 *
 * Thin wrapper around `getSecretMisconfigurationState` so the misconfig
 * check and the unset-vs-defaulted classification stay in lockstep.
 */
export function isSecretMisconfigured(secret: GuardedSecret): boolean {
  return getSecretMisconfigurationState(secret) !== null;
}

/**
 * The set of guarded secrets currently misconfigured in production. Returns
 * an empty array outside production (local dev / CI legitimately run
 * without these secrets configured).
 */
export function getMisconfiguredCriticalSecrets(): GuardedSecret[] {
  if (process.env.NODE_ENV !== "production") return [];
  return GUARDED_SECRETS.filter(isSecretMisconfigured);
}

export interface ProductionEnvGuardAlertPayload {
  kind: AlertKind;
  secret: GuardedSecret;
  now: number;
}

/**
 * Per-secret delivery result. Same shape the shared dispatcher returns,
 * augmented with the `secretId` so admins / tests can tell which guarded
 * secret a given outcome refers to when several fire in parallel.
 */
export interface DeliveryResult extends BaseDeliveryResult {
  secretId: string;
}

interface PerSecretAlertingState {
  alerting: boolean;
}

const alertingState = new Map<string, PerSecretAlertingState>();

function getAlertingState(id: string): PerSecretAlertingState {
  let s = alertingState.get(id);
  if (!s) {
    s = { alerting: false };
    alertingState.set(id, s);
  }
  return s;
}

function destinationsFromEnv(): OnCallDestinations {
  return {
    pagerdutyIntegrationKey: process.env.PAGERDUTY_INTEGRATION_KEY ?? null,
    opsAlertEmail: process.env.OPS_ALERT_EMAIL ?? null,
    opsAlertSlackWebhookUrl: process.env.OPS_ALERT_SLACK_WEBHOOK_URL ?? null,
  };
}

function fireSummary(secret: GuardedSecret): string {
  return `${secret.envVar} unset/defaulted in production — ${secret.title}`;
}

function buildMessages(p: ProductionEnvGuardAlertPayload): AlertMessages {
  const subject =
    p.kind === "fire"
      ? `[ALERT] ${p.secret.title}`
      : `[RESOLVED] ${p.secret.envVar} restored in production`;
  const text =
    p.kind === "fire"
      ? [
          p.secret.message,
          "",
          `Confirm via /admin/system once ${p.secret.envVar} is restored on the API service.`,
        ].join("\n")
      : [
          `${p.secret.envVar} is now configured again on the production API server.`,
        ].join("\n");
  const slackText =
    p.kind === "fire"
      ? `:rotating_light: *${p.secret.title}* — ${p.secret.message}`
      : `:white_check_mark: *${p.secret.envVar} restored in production* — guard cleared.`;
  return {
    pagerduty: {
      // Per-secret dedup so each guarded secret has its own incident on
      // PagerDuty — re-triggers fold into the existing one and a "resolve"
      // event auto-closes that specific incident without touching others.
      dedupKey: `production-env-guard:${p.secret.id}`,
      summary: fireSummary(p.secret),
      severity: "error",
      component: "production-env-guard",
      class: "production_env_secret_missing",
      custom_details: {
        env_var: p.secret.envVar,
        secret_id: p.secret.id,
      },
    },
    email: { subject, text },
    slack: { text: slackText },
  };
}

const throttleStore = createInMemoryThrottleStore();

const baseDispatcher = createOnCallDispatcher<
  ProductionEnvGuardAlertPayload,
  string
>({
  name: "ProductionEnvGuard",
  destinations: destinationsFromEnv,
  throttleMs: getNotificationThrottleMs,
  throttleStore,
  // Throttle key carries the secret id so each guarded secret has its own
  // (per-channel, per-kind) throttle slot.
  throttleKey: (p, dc) => `${p.secret.id}:${p.kind}:${dc}`,
  buildMessages,
  kindOf: (p) => p.kind,
});

function tagWithSecretId(
  secretId: string,
  result: BaseDeliveryResult,
): DeliveryResult {
  return { ...result, secretId };
}

/** Test-only: replace one or more delivery functions with stubs. */
export function __setProductionEnvGuardDeliveriesForTests(
  overrides: Partial<
    Record<DeliveryChannel, DeliveryFn<ProductionEnvGuardAlertPayload>>
  > | null,
): void {
  baseDispatcher.setDeliveryOverrides(overrides);
}

/** Test-only: reset all alerter state. */
export function __resetProductionEnvGuardForTests(): void {
  alertingState.clear();
  throttleStore.reset();
  baseDispatcher.setDeliveryOverrides(null);
  // Keep test state hygienic: a previous test may have flipped the shared
  // SendGrid init flag when it exercised the email delivery path with
  // SENDGRID_API_KEY set, and a later test asserting on a cold-start init
  // sequence would otherwise see stale state.
  __resetSendGridInitForTests();
}

async function dispatchForSecret(
  payload: ProductionEnvGuardAlertPayload,
): Promise<DeliveryResult[]> {
  const results = await baseDispatcher.dispatch(payload, payload.now);
  return results.map((r) => tagWithSecretId(payload.secret.id, r));
}

/**
 * Walk every guarded secret and dispatch any state-transition alerts
 * (fire on first detection of a missing secret, clear when it comes back).
 *
 * No-op outside production. Safe to call frequently; transitions are gated
 * by per-secret state and deliveries are throttled per channel per secret.
 *
 * Concurrency: the route-level dispatch is fire-and-forget while the
 * background poll runs every few minutes. Both call sites share the
 * per-secret `alerting` flag, so we flip the transition flag *before*
 * awaiting dispatch. Any concurrent call that arrives mid-dispatch sees
 * the new state and returns immediately for that secret instead of
 * double-paging.
 */
export async function evaluateProductionEnvGuards(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  if (process.env.NODE_ENV !== "production") {
    return [];
  }
  const results: DeliveryResult[] = [];
  for (const secret of GUARDED_SECRETS) {
    const state = getAlertingState(secret.id);
    const currentlyMissing = isSecretMisconfigured(secret);
    const prev = state.alerting;
    if (currentlyMissing && !prev) {
      state.alerting = true;
      const r = await dispatchForSecret({ kind: "fire", secret, now });
      results.push(...r);
    } else if (!currentlyMissing && prev) {
      state.alerting = false;
      const r = await dispatchForSecret({ kind: "clear", secret, now });
      results.push(...r);
    }
  }
  return results;
}

const runner = createPollRunner({
  name: "ProductionEnvGuard",
  pollMs: POLL_MS,
  evaluate: () => evaluateProductionEnvGuards(),
  startupEvaluate: true,
});

/**
 * Run a startup check and start the recovery poll so a misconfiguration is
 * detected even if no admin loads the dashboard. Idempotent.
 */
export function startProductionEnvGuard(): void {
  runner.start();
}

/** Stop the poll. */
export function stopProductionEnvGuard(): void {
  runner.stop();
}
