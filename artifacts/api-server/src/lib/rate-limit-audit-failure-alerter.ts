/**
 * Sends real on-call notifications when the abuse rate-limit middleware's
 * audit-write hook starts silently dropping rows. The tracker
 * (see `rate-limit-audit-failure-tracker.ts`) bumps a counter every time the
 * `onLimitExceeded` audit insert throws — usually because the database is
 * flapping during a credential-stuffing wave. The 429s themselves keep
 * flowing, so the user-visible behavior is fine, but the audit trail
 * security on-callers rely on to *notice* the attack silently disappears.
 * Today the only signal is a `[AbuseRateLimit][AuditFailure]` log line and
 * a counter on System Health that nobody is watching during a real
 * incident — which defeats the point of the audit trail.
 *
 * Mirrors `abuse-rate-limit-cleanup-alerter.ts` so on-call only ever has to
 * learn one alert pattern. Each delivery channel (PagerDuty / ops email /
 * Slack) is independently optional and configured via the same env vars
 * used by the queue-fallback / signup-challenge / cleanup alerters:
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY   (Events API v2 routing key)
 *   - Ops email:  OPS_ALERT_EMAIL             (sent via SendGrid)
 *                 OPS_ALERT_FROM_EMAIL        (defaults to FROM_EMAIL or noreply@buildtestscale.com)
 *                 SENDGRID_API_KEY            (required for the email channel)
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL (incoming webhook URL)
 *
 * Behavior:
 *   - We watch the cluster-local counter. When it grows by >= a small
 *     threshold (default 5) since the last alert baseline, we transition
 *     into the "alerting" state and send a single "fire" alert per
 *     delivery channel.
 *   - While we stay in the alerting state, continued growth past the
 *     threshold re-attempts dispatch — but the per-delivery throttle
 *     (default 15m) suppresses every one of those re-fires until the
 *     window expires, so a sustained outage produces *one* page per
 *     window rather than spamming on-call.
 *   - When the counter has been quiet (no growth observed) for a recovery
 *     window (default 10 minutes), we send an "all clear".
 *   - PagerDuty incidents use a stable dedup_key
 *     (`rate-limit-audit-failure:dropping`) so re-triggers fold into the
 *     existing incident and a "resolve" event auto-closes it.
 *   - The counter is per-process and not persisted; this alerter therefore
 *     reflects the local pod's view. That matches how the System Health
 *     panel renders the same counter and is what an operator wants when
 *     correlating against per-pod dashboards (a cluster-wide view would
 *     hide which instance has the broken DB connection).
 */

import { gatedSendEmail } from "./email-transport";
import {
  getRateLimitAuditFailureStats,
  type RateLimitAuditFailureStats,
} from "./rate-limit-audit-failure-tracker";

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
    "RATE_LIMIT_AUDIT_FAILURE_NOTIFICATION_THROTTLE_MS",
    15 * 60 * 1000,
  );
}

function getAlertThreshold(): number {
  // Small by design: a credential-stuffing wave that drops even a handful
  // of audit rows is already worth paging on, since each missing row is
  // an attacker-driven 429 we now can't reconstruct. Configurable via env
  // so a noisy environment can raise the bar without a code change.
  const raw = parseEnvInt("RATE_LIMIT_AUDIT_FAILURE_ALERT_THRESHOLD", 5);
  return raw > 0 ? raw : 5;
}

function getRecoveryWindowMs(): number {
  return parseEnvInt(
    "RATE_LIMIT_AUDIT_FAILURE_RECOVERY_WINDOW_MS",
    10 * 60 * 1000,
  );
}

// 1 minute by default — fast enough that a real outage is caught within
// a couple of minutes of the first dropped row, slow enough that the poll
// itself doesn't generate noticeable load. Matches the queue-fallback
// alerter's poll cadence.
const POLL_MS = parseEnvInt(
  "RATE_LIMIT_AUDIT_FAILURE_ALERTER_POLL_MS",
  60 * 1000,
);

interface AlertState {
  /** True if we currently consider audit failures "alerting". */
  alerting: boolean;
  /**
   * `totalCount` value at the moment we last attempted to fire. New growth
   * past the threshold is measured against this baseline so a sustained
   * outage that crosses 5 → 10 → 15 → 20 dropped rows triggers one fire
   * attempt per threshold-sized batch (with the throttle suppressing all
   * but one per window).
   */
  baselineCount: number;
  /** Last `totalCount` value observed by `evaluate`. */
  lastSeenCount: number;
  /** Wall-clock time when we last saw the counter grow. Drives recovery. */
  lastGrowthAt: number | null;
  /** Per-delivery-channel timestamp of the last successful "fire" send. */
  lastFireAt: Partial<Record<DeliveryChannel, number>>;
  /** Per-delivery-channel timestamp of the last successful "clear" send. */
  lastClearAt: Partial<Record<DeliveryChannel, number>>;
}

const alertState: AlertState = {
  alerting: false,
  baselineCount: 0,
  lastSeenCount: 0,
  lastGrowthAt: null,
  lastFireAt: {},
  lastClearAt: {},
};

export interface RateLimitAuditFailureAlertPayload {
  kind: AlertKind;
  now: number;
  /**
   * Snapshot of the failure counters at the moment the transition was
   * detected. Used to populate the alert body so on-call sees how many
   * rows have been dropped, by which limiter, and the most recent error
   * — without having to open System Health first.
   */
  stats: RateLimitAuditFailureStats;
  /**
   * Number of new failures observed since the previous baseline. Echoed
   * into the alert body so on-call can tell "5 dropped rows" apart from
   * "5,000 dropped rows" without having to read the per-limiter map.
   */
  delta: number;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  ok: boolean;
  /** True if no notification was attempted (e.g. provider not configured or throttled). */
  skipped?: boolean;
  reason?: string;
}

type DeliveryFn = (
  payload: RateLimitAuditFailureAlertPayload,
) => Promise<DeliveryResult>;

function describeTopLimiters(stats: RateLimitAuditFailureStats): string {
  const entries = Object.entries(stats.byName)
    .map(([name, s]) => ({ name, count: s.count, lastError: s.lastError }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  if (entries.length === 0) return "(no per-limiter breakdown)";
  return entries
    .map(
      (e) =>
        `${e.name}: ${e.count}${e.lastError ? ` (${e.lastError})` : ""}`,
    )
    .join("; ");
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
    const dedupKey = "rate-limit-audit-failure:dropping";
    const summary =
      p.kind === "fire"
        ? `Abuse rate-limit audit writes are silently dropping — ${p.delta} new failure(s), ${p.stats.totalCount} total since process start`
        : "Abuse rate-limit audit writes have recovered";
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
              component: "abuse-rate-limit",
              class: "rate_limit_audit_failure",
              custom_details: {
                delta: p.delta,
                totalCount: p.stats.totalCount,
                lastAt: p.stats.lastAt,
                byName: p.stats.byName,
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
        ? "[ALERT] Abuse rate-limit audit writes are silently dropping"
        : "[RESOLVED] Abuse rate-limit audit writes recovered";
    const text =
      p.kind === "fire"
        ? [
            `The abuse rate-limit middleware's audit-write hook has thrown ${p.delta} time(s) in the latest window`,
            `(${p.stats.totalCount} total since process start, last at ${p.stats.lastAt ?? "n/a"}).`,
            "",
            "The 429 responses to the offending clients are still being served, but the audit",
            "rows that document each block are being dropped — most often this means the database",
            "is flapping during a credential-stuffing wave. The audit trail security on-call",
            "depends on to reconstruct the attack is silently disappearing.",
            "",
            `Top limiters: ${describeTopLimiters(p.stats)}`,
            "",
            "Open /admin/system and check the 'Rate-limit audit-write failures' panel.",
          ].join("\n")
        : [
            "The abuse rate-limit audit-write hook has been quiet for the recovery window —",
            "no new dropped audit rows observed. Marking the alert resolved.",
            "",
            `Total dropped since process start: ${p.stats.totalCount}.`,
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
    const text =
      p.kind === "fire"
        ? `:rotating_light: *Abuse rate-limit audit writes are silently dropping* — ${p.delta} new failure(s), ${p.stats.totalCount} total. Top limiters: ${describeTopLimiters(p.stats)}. Check /admin/system.`
        : `:white_check_mark: *Abuse rate-limit audit writes recovered* — no new dropped rows in the last few minutes. Total since start: ${p.stats.totalCount}.`;
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
export function __setRateLimitAuditFailureAlerterDeliveriesForTests(
  overrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null,
): void {
  deliveryOverrides = overrides;
}

/** Test-only: reset all alerter state. */
export function __resetRateLimitAuditFailureAlerterForTests(): void {
  alertState.alerting = false;
  alertState.baselineCount = 0;
  alertState.lastSeenCount = 0;
  alertState.lastGrowthAt = null;
  alertState.lastFireAt = {};
  alertState.lastClearAt = {};
  deliveryOverrides = null;
}

async function dispatchAll(
  payload: RateLimitAuditFailureAlertPayload,
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
      // a "skipped" (no provider configured) shouldn't gate the next
      // attempt, and a thrown error already returns ok:false below
      // without burning the slot either.
      if (result.ok && !result.skipped) {
        lastMap[dc] = payload.now;
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[RateLimitAuditFailureAlerter] ${dc} ${payload.kind} failed:`,
        err,
      );
      return { channel: dc, ok: false, reason };
    }
  });
  return Promise.all(promises);
}

/**
 * Read the current rate-limit audit-failure counters and dispatch any
 * state-transition alerts:
 *   - "fire" when the counter has grown by >= the threshold since the
 *     last baseline (entering the alerting state, or sustained growth
 *     while still alerting — the throttle gates spam).
 *   - "clear" when no growth has been observed for the recovery window
 *     while in the alerting state.
 *
 * Safe to call frequently; transitions are gated by the `alerting` flag
 * and deliveries are throttled. The state flag is flipped synchronously
 * before awaiting dispatch so concurrent calls don't double-page on the
 * same first-time outage (mirrors the signup-challenge alerter).
 */
export async function evaluateRateLimitAuditFailureAlert(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const stats = getRateLimitAuditFailureStats();
  const total = stats.totalCount;
  const sinceLastSeen = total - alertState.lastSeenCount;
  if (sinceLastSeen > 0) {
    alertState.lastGrowthAt = now;
  }
  alertState.lastSeenCount = total;

  const threshold = getAlertThreshold();
  const sinceBaseline = total - alertState.baselineCount;

  // Fire when growth past the threshold accumulates. We attempt dispatch
  // both on the first transition into alerting AND while already alerting
  // (so a sustained outage gets one fire per throttle window, not just
  // one per outage). The per-channel throttle inside `dispatchAll`
  // suppresses re-fires within the window.
  if (sinceBaseline >= threshold) {
    alertState.alerting = true;
    alertState.baselineCount = total;
    return dispatchAll({
      kind: "fire",
      now,
      stats,
      delta: sinceBaseline,
    });
  }

  // Auto-clear when we're alerting and the counter has been quiet for
  // the recovery window. There's no natural "all-good" signal from the
  // tracker (the counter is monotonic), so quiet-time is the proxy.
  if (
    alertState.alerting &&
    alertState.lastGrowthAt !== null &&
    now - alertState.lastGrowthAt >= getRecoveryWindowMs()
  ) {
    alertState.alerting = false;
    return dispatchAll({ kind: "clear", now, stats, delta: 0 });
  }

  return [];
}

/**
 * Public read-only view of the alerter's current state. Surfaced by the
 * admin notifications endpoint so the bell can render a "currently
 * paging" notification without re-deriving the transition logic.
 */
export function getRateLimitAuditFailureAlertingState(): {
  alerting: boolean;
  baselineCount: number;
  lastSeenCount: number;
  lastGrowthAt: string | null;
} {
  return {
    alerting: alertState.alerting,
    baselineCount: alertState.baselineCount,
    lastSeenCount: alertState.lastSeenCount,
    lastGrowthAt:
      alertState.lastGrowthAt !== null
        ? new Date(alertState.lastGrowthAt).toISOString()
        : null,
  };
}

let pollHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Run a startup check and start the recovery poll so a silent
 * audit-write outage is detected even if no admin loads the dashboard
 * and no request happens to call `evaluate` from the route layer.
 * Idempotent.
 */
export function startRateLimitAuditFailureAlerter(): void {
  if (started) return;
  started = true;
  evaluateRateLimitAuditFailureAlert().catch((err) => {
    console.error("[RateLimitAuditFailureAlerter] startup error:", err);
  });
  if (POLL_MS > 0) {
    pollHandle = setInterval(() => {
      evaluateRateLimitAuditFailureAlert().catch((err) => {
        console.error("[RateLimitAuditFailureAlerter] poll error:", err);
      });
    }, POLL_MS);
    pollHandle.unref?.();
  }
}

/** Stop the poll. */
export function stopRateLimitAuditFailureAlerter(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  started = false;
}
