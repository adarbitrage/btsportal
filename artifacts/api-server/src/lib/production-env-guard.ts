/**
 * Production env guard — pages on-call when other production-critical
 * secrets are unset/defaulted.
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
 * Delivery channels are configured via the same env vars used by the other
 * alerters:
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
 */

import sgMail from "@sendgrid/mail";

type DeliveryChannel = "pagerduty" | "email" | "slack";
type AlertKind = "fire" | "clear";

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

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getNotificationThrottleMs(): number {
  return parseEnvInt(
    "PRODUCTION_ENV_GUARD_NOTIFICATION_THROTTLE_MS",
    60 * 60 * 1000,
  );
}

const POLL_MS = parseEnvInt(
  "PRODUCTION_ENV_GUARD_POLL_MS",
  5 * 60 * 1000,
);

/**
 * Returns true when the secret should be considered misconfigured: unset,
 * empty/whitespace, or matching one of the known placeholder defaults.
 */
export function isSecretMisconfigured(secret: GuardedSecret): boolean {
  const raw = process.env[secret.envVar];
  if (typeof raw !== "string") return true;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  if (secret.defaultedValues && secret.defaultedValues.includes(trimmed)) {
    return true;
  }
  return false;
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

interface PerSecretAlertState {
  /** Whether we currently consider this secret in an "alerting" state. */
  alerting: boolean;
  /** Per-channel timestamp of the last successful "fire" send. */
  lastFireAt: Partial<Record<DeliveryChannel, number>>;
  /** Per-channel timestamp of the last successful "clear" send. */
  lastClearAt: Partial<Record<DeliveryChannel, number>>;
}

const alertState: Map<string, PerSecretAlertState> = new Map();

function getState(id: string): PerSecretAlertState {
  let s = alertState.get(id);
  if (!s) {
    s = { alerting: false, lastFireAt: {}, lastClearAt: {} };
    alertState.set(id, s);
  }
  return s;
}

export interface ProductionEnvGuardAlertPayload {
  kind: AlertKind;
  secret: GuardedSecret;
  now: number;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  secretId: string;
  ok: boolean;
  /** True if no notification was attempted (e.g. provider not configured or throttled). */
  skipped?: boolean;
  reason?: string;
}

type DeliveryFn = (
  payload: ProductionEnvGuardAlertPayload,
) => Promise<DeliveryResult>;

let sgMailInitialized = false;

function fireSummary(secret: GuardedSecret): string {
  return `${secret.envVar} unset/defaulted in production — ${secret.title}`;
}

const defaultDeliveries: Record<DeliveryChannel, DeliveryFn> = {
  pagerduty: async (p) => {
    const key = process.env.PAGERDUTY_INTEGRATION_KEY;
    if (!key) {
      return {
        channel: "pagerduty",
        secretId: p.secret.id,
        ok: true,
        skipped: true,
        reason: "not_configured",
      };
    }
    // Per-secret dedup so each guarded secret has its own incident on
    // PagerDuty — re-triggers fold into the existing one and a "resolve"
    // event auto-closes that specific incident without touching the others.
    const dedupKey = `production-env-guard:${p.secret.id}`;
    const body =
      p.kind === "fire"
        ? {
            routing_key: key,
            event_action: "trigger",
            dedup_key: dedupKey,
            payload: {
              summary: fireSummary(p.secret),
              severity: "error",
              source: process.env.HOSTNAME ?? "api-server",
              component: "production-env-guard",
              class: "production_env_secret_missing",
              custom_details: {
                env_var: p.secret.envVar,
                secret_id: p.secret.id,
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
      return {
        channel: "pagerduty",
        secretId: p.secret.id,
        ok: false,
        reason: `http_${res.status}`,
      };
    }
    return { channel: "pagerduty", secretId: p.secret.id, ok: true };
  },

  email: async (p) => {
    const to = process.env.OPS_ALERT_EMAIL;
    if (!to) {
      return {
        channel: "email",
        secretId: p.secret.id,
        ok: true,
        skipped: true,
        reason: "not_configured",
      };
    }
    if (!process.env.SENDGRID_API_KEY) {
      return {
        channel: "email",
        secretId: p.secret.id,
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
    await sgMail.send({ to, from, subject, text });
    return { channel: "email", secretId: p.secret.id, ok: true };
  },

  slack: async (p) => {
    const url = process.env.OPS_ALERT_SLACK_WEBHOOK_URL;
    if (!url) {
      return {
        channel: "slack",
        secretId: p.secret.id,
        ok: true,
        skipped: true,
        reason: "not_configured",
      };
    }
    const text =
      p.kind === "fire"
        ? `:rotating_light: *${p.secret.title}* — ${p.secret.message}`
        : `:white_check_mark: *${p.secret.envVar} restored in production* — guard cleared.`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      return {
        channel: "slack",
        secretId: p.secret.id,
        ok: false,
        reason: `http_${res.status}`,
      };
    }
    return { channel: "slack", secretId: p.secret.id, ok: true };
  },
};

let deliveryOverrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null =
  null;

/** Test-only: replace one or more delivery functions with stubs. */
export function __setProductionEnvGuardDeliveriesForTests(
  overrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null,
): void {
  deliveryOverrides = overrides;
}

/** Test-only: reset all alerter state. */
export function __resetProductionEnvGuardForTests(): void {
  alertState.clear();
  deliveryOverrides = null;
  // Keep test state hygienic: a previous test may have flipped this when
  // it exercised the email delivery path with SENDGRID_API_KEY set, and a
  // later test asserting on a cold-start init sequence would otherwise
  // see stale state.
  sgMailInitialized = false;
}

async function dispatchForSecret(
  payload: ProductionEnvGuardAlertPayload,
): Promise<DeliveryResult[]> {
  const state = getState(payload.secret.id);
  const lastMap =
    payload.kind === "fire" ? state.lastFireAt : state.lastClearAt;
  const promises: Promise<DeliveryResult>[] = (
    ["pagerduty", "email", "slack"] as const
  ).map(async (dc) => {
    const last = lastMap[dc] ?? 0;
    if (last > 0 && payload.now - last < getNotificationThrottleMs()) {
      return {
        channel: dc,
        secretId: payload.secret.id,
        ok: true,
        skipped: true,
        reason: "throttled",
      };
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
        `[ProductionEnvGuard] ${dc} ${payload.kind} for ${payload.secret.envVar} failed:`,
        err,
      );
      return { channel: dc, secretId: payload.secret.id, ok: false, reason };
    }
  });
  return Promise.all(promises);
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
    const state = getState(secret.id);
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

let pollHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Run a startup check and start the recovery poll so a misconfiguration is
 * detected even if no admin loads the dashboard. Idempotent.
 */
export function startProductionEnvGuard(): void {
  if (started) return;
  started = true;
  evaluateProductionEnvGuards().catch((err) => {
    console.error("[ProductionEnvGuard] startup error:", err);
  });
  if (POLL_MS > 0) {
    pollHandle = setInterval(() => {
      evaluateProductionEnvGuards().catch((err) => {
        console.error("[ProductionEnvGuard] poll error:", err);
      });
    }, POLL_MS);
    pollHandle.unref?.();
  }
}

/** Stop the poll. */
export function stopProductionEnvGuard(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  started = false;
}
