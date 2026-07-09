/**
 * Sends real on-call notifications when the abuse rate-limit cleanup sweep
 * (see `abuse-rate-limit-cleanup.ts`) silently stops running. The sweep is
 * the belt-and-suspenders backstop behind the per-key cap on every write,
 * and the System Health page already surfaces a "stale" state when the
 * hourly sweep hasn't reported a run in > 2h. But that signal only fires
 * if an admin happens to look at System Health — which defeats the point
 * of the watchdog. This alerter pages on-call so a stuck job is caught
 * proactively.
 *
 * Mirrors `signup-challenge-alerter.ts` so on-call only ever has to learn
 * one alert pattern. Each delivery channel (PagerDuty / ops email / Slack)
 * is independently optional and configured via the same env vars used by
 * the queue-fallback / signup-challenge / production-env-guard alerters:
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY   (Events API v2 routing key)
 *   - Ops email:  OPS_ALERT_EMAIL             (sent via SendGrid)
 *                 OPS_ALERT_FROM_EMAIL        (defaults to FROM_EMAIL or noreply@buildtestscale.com)
 *                 SENDGRID_API_KEY            (required for the email channel)
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL (incoming webhook URL)
 *
 * Behavior:
 *   - When the cleanup status transitions from "fresh" to "stale" (the same
 *     condition the System Health panel surfaces — `enabled && stale`), we
 *     send a single "fire" alert per delivery channel.
 *   - When it transitions back ("stale" -> "fresh"), we send an
 *     "all clear".
 *   - Each delivery channel is throttled to at most one notification per
 *     ABUSE_RATE_LIMIT_CLEANUP_NOTIFICATION_THROTTLE_MS (default 1 hour) so
 *     a flapping job (e.g. one slow Redis call per evaluation) cannot spam
 *     on-call.
 *   - PagerDuty incidents use a stable dedup_key
 *     (`abuse-rate-limit-cleanup:stale`) so re-triggers fold into the
 *     existing incident and a "resolve" event auto-closes it.
 *   - When the cleanup job is not enabled at all (no `REDIS_URL`), the
 *     evaluator is a no-op — local dev / CI legitimately run without the
 *     sweep configured.
 */

import { gatedSendEmail } from "./email-transport";
import { getAbuseRateLimitCleanupStatus } from "./abuse-rate-limit-cleanup";

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
    "ABUSE_RATE_LIMIT_CLEANUP_NOTIFICATION_THROTTLE_MS",
    60 * 60 * 1000,
  );
}

// 15 minutes by default — fast enough that a stuck job is caught well within
// the 2× run-interval staleness threshold (2h), slow enough that the poll
// itself doesn't generate noticeable load.
const POLL_MS = parseEnvInt(
  "ABUSE_RATE_LIMIT_CLEANUP_ALERTER_POLL_MS",
  15 * 60 * 1000,
);

interface AlertState {
  /** True if we currently consider the cleanup sweep "alerting" (stale). */
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

export interface AbuseRateLimitCleanupAlertPayload {
  kind: AlertKind;
  now: number;
  /**
   * Snapshot of the cleanup status at the moment the transition was
   * detected. Used to populate the alert body so on-call sees how long the
   * sweep has been silent and the last error (if any) without having to
   * open System Health first.
   */
  status: Awaited<ReturnType<typeof getAbuseRateLimitCleanupStatus>>;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  ok: boolean;
  /** True if no notification was attempted (e.g. provider not configured or throttled). */
  skipped?: boolean;
  reason?: string;
}

type DeliveryFn = (
  payload: AbuseRateLimitCleanupAlertPayload,
) => Promise<DeliveryResult>;

const FIRE_SUMMARY =
  "Abuse rate-limit cleanup sweep is stale — the hourly sweep has not reported a run in > 2h, leaving the per-key memory backstop unmaintained";

function describeStatus(
  status: AbuseRateLimitCleanupAlertPayload["status"],
): string {
  const parts: string[] = [];
  parts.push(`Last successful run: ${status.lastRanAt ?? "never"}`);
  if (status.lastError) {
    parts.push(
      `Last error: ${status.lastError.message} (at ${status.lastError.at})`,
    );
  }
  parts.push(
    `Run interval: ${Math.round(status.intervalMs / 60000)}m`,
  );
  return parts.join(" \u2014 ");
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
    const dedupKey = "abuse-rate-limit-cleanup:stale";
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
              component: "abuse-rate-limit-cleanup",
              class: "abuse_rate_limit_cleanup_stale",
              custom_details: {
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
    const from =
      process.env.OPS_ALERT_FROM_EMAIL ??
      process.env.FROM_EMAIL ??
      "noreply@buildtestscale.com";
    const subject =
      p.kind === "fire"
        ? "[ALERT] Abuse rate-limit cleanup sweep is stale"
        : "[RESOLVED] Abuse rate-limit cleanup sweep recovered";
    const text =
      p.kind === "fire"
        ? [
            "The hourly abuse rate-limit cleanup sweep has not reported a run in over two run intervals.",
            "The middleware-level per-key cap is still in place, but stale entries and empty keys are no longer being trimmed.",
            "",
            describeStatus(p.status),
            "",
            "Open /admin/system and check the 'Rate-limit hygiene' panel.",
          ].join("\n")
        : [
            "The abuse rate-limit cleanup sweep has reported a fresh run; the watchdog is no longer stale.",
            "",
            describeStatus(p.status),
            "",
            "Confirm via /admin/system.",
          ].join("\n");
    await gatedSendEmail({ to, from, subject, text });
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
    const lastRan = p.status.lastRanAt ?? "never";
    const text =
      p.kind === "fire"
        ? `:rotating_light: *Abuse rate-limit cleanup sweep is stale* — last run: ${lastRan}. Stale entries and empty keys are no longer being trimmed. Check /admin/system (Rate-limit hygiene panel).`
        : `:white_check_mark: *Abuse rate-limit cleanup sweep recovered* — last run: ${lastRan}.`;
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
export function __setAbuseRateLimitCleanupAlerterDeliveriesForTests(
  overrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null,
): void {
  deliveryOverrides = overrides;
}

/** Test-only: reset all alerter state. */
export function __resetAbuseRateLimitCleanupAlerterForTests(): void {
  alertState.alerting = false;
  alertState.lastFireAt = {};
  alertState.lastClearAt = {};
  deliveryOverrides = null;
}

async function dispatchAll(
  payload: AbuseRateLimitCleanupAlertPayload,
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
        `[AbuseRateLimitCleanupAlerter] ${dc} ${payload.kind} failed:`,
        err,
      );
      return { channel: dc, ok: false, reason };
    }
  });
  return Promise.all(promises);
}

/**
 * Read the current cleanup-sweep status and dispatch any state-transition
 * alerts (fire on first detection that the sweep has gone stale, clear when
 * a fresh run lands). No-op when the cleanup job is not enabled (no
 * `REDIS_URL`). Safe to call frequently; transitions are gated by the
 * `alerting` flag and deliveries are throttled.
 *
 * Concurrency: the background poll runs every few minutes and could in
 * principle overlap with a future on-demand evaluation. Both call sites
 * share `alertState.alerting`, so we flip the transition flag *before*
 * awaiting dispatch — any concurrent call that arrives mid-dispatch sees
 * the new state and returns immediately instead of double-paging.
 */
export async function evaluateAbuseRateLimitCleanupAlert(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const status = await getAbuseRateLimitCleanupStatus();
  if (!status.enabled) {
    return [];
  }
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
 * Run a startup check and start the recovery poll so a stuck cleanup sweep
 * is detected even if no admin loads the dashboard. Idempotent.
 */
export function startAbuseRateLimitCleanupAlerter(): void {
  if (started) return;
  started = true;
  evaluateAbuseRateLimitCleanupAlert().catch((err) => {
    console.error("[AbuseRateLimitCleanupAlerter] startup error:", err);
  });
  if (POLL_MS > 0) {
    pollHandle = setInterval(() => {
      evaluateAbuseRateLimitCleanupAlert().catch((err) => {
        console.error("[AbuseRateLimitCleanupAlerter] poll error:", err);
      });
    }, POLL_MS);
    pollHandle.unref?.();
  }
}

/** Stop the poll. */
export function stopAbuseRateLimitCleanupAlerter(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  started = false;
}
