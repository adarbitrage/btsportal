/**
 * Sends on-call notifications when the background moderation queue starts
 * dropping jobs. The tracker (`failure-tracker.ts`) records every engine
 * or persist failure; this alerter polls the tracker on an interval, runs
 * the rolling-window threshold check, and dispatches a single page per
 * channel per throttle window when failures exceed the configured limit.
 *
 * Mirrors `rate-limit-audit-failure-alerter.ts` so on-call only has to
 * learn one alert pattern. Each delivery channel (PagerDuty / ops email /
 * Slack) is independently optional and uses the same env vars as the
 * other alerters:
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY
 *   - Ops email:  OPS_ALERT_EMAIL (sent via SendGrid)
 *                 OPS_ALERT_FROM_EMAIL (defaults to FROM_EMAIL or noreply@buildtestscale.com)
 *                 SENDGRID_API_KEY
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL
 *
 * Threshold + window are admin-tunable via `failure-alert-settings.ts`
 * (stored in `system_settings`), with env-var fallbacks for backwards
 * compatibility:
 *   - MODERATION_FAILURE_NOTIFICATION_THROTTLE_MS   (default 15 min)
 *   - MODERATION_FAILURE_RECOVERY_WINDOW_MS         (default 10 min)
 *   - MODERATION_FAILURE_ALERTER_POLL_MS            (default 60s)
 *
 * State machine:
 *   - Fire when the rolling-window failure count crosses the threshold.
 *     Re-fire attempts while still alerting are suppressed by the
 *     per-channel throttle so a sustained outage produces one page per
 *     window instead of spamming on-call.
 *   - Clear when no new failures arrive for the recovery window. The
 *     tracker's lazy-prune means the rolling window naturally drops back
 *     below threshold without needing a separate "all-good" signal.
 *   - PagerDuty incidents use a stable dedup_key so re-triggers fold into
 *     the existing incident and the resolve event auto-closes it.
 */

import sgMail from "@sendgrid/mail";
import {
  getModerationFailuresInWindowAggregated,
  getModerationFailureCumulativeStats,
  type ModerationFailureWindowStats,
  type ModerationFailureCumulativeStats,
  type ModerationFailurePodStats,
} from "./failure-tracker";
import {
  getModerationFailureAlertConfig,
  MODERATION_FAILURE_ALERT_DEFAULTS,
} from "./failure-alert-settings";
import {
  isPodStale,
  staleThresholdMsForWindow,
} from "@workspace/moderation-shared";

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
    "MODERATION_FAILURE_NOTIFICATION_THROTTLE_MS",
    15 * 60 * 1000,
  );
}

function getRecoveryWindowMs(): number {
  return parseEnvInt(
    "MODERATION_FAILURE_RECOVERY_WINDOW_MS",
    10 * 60 * 1000,
  );
}

const POLL_MS = parseEnvInt(
  "MODERATION_FAILURE_ALERTER_POLL_MS",
  60 * 1000,
);

interface AlertState {
  alerting: boolean;
  /** Wall-clock time of the last successful "fire" evaluation. */
  lastFireEvaluatedAt: number | null;
  /** Last in-window total observed by `evaluate`. */
  lastSeenWindowTotal: number;
  /** Wall-clock time we last observed an in-window failure (for recovery). */
  lastInWindowFailureAt: number | null;
  lastFireAt: Partial<Record<DeliveryChannel, number>>;
  lastClearAt: Partial<Record<DeliveryChannel, number>>;
}

const alertState: AlertState = {
  alerting: false,
  lastFireEvaluatedAt: null,
  lastSeenWindowTotal: 0,
  lastInWindowFailureAt: null,
  lastFireAt: {},
  lastClearAt: {},
};

export interface ModerationFailureAlertPayload {
  kind: AlertKind;
  now: number;
  /** Threshold that was in force when the transition was detected. */
  threshold: number;
  /** Window length (ms) that was in force when the transition was detected. */
  windowMs: number;
  /** Snapshot of failures inside the rolling window at transition time. */
  window: ModerationFailureWindowStats;
  /** Cumulative failures since process start. Lets on-call distinguish
   *  a fresh outage from a sustained one. */
  cumulative: ModerationFailureCumulativeStats;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

type DeliveryFn = (payload: ModerationFailureAlertPayload) => Promise<DeliveryResult>;

let sgMailInitialized = false;

function describeKindBreakdown(window: ModerationFailureWindowStats): string {
  const parts: string[] = [];
  if (window.byKind.engine > 0) parts.push(`engine: ${window.byKind.engine}`);
  if (window.byKind.persist > 0) parts.push(`persist: ${window.byKind.persist}`);
  return parts.length > 0 ? parts.join("; ") : "(no in-window breakdown)";
}

const defaultDeliveries: Record<DeliveryChannel, DeliveryFn> = {
  pagerduty: async (p) => {
    const key = process.env.PAGERDUTY_INTEGRATION_KEY;
    if (!key) {
      return { channel: "pagerduty", ok: true, skipped: true, reason: "not_configured" };
    }
    const dedupKey = "moderation-failure:dropping";
    const minutes = Math.round(p.windowMs / 60000);
    const summary =
      p.kind === "fire"
        ? `Moderation queue failures over threshold — ${p.window.totalCount} in the last ${minutes}m (threshold ${p.threshold}); ${describeKindBreakdown(p.window)}`
        : "Moderation queue failures recovered";
    const body =
      p.kind === "fire"
        ? {
            routing_key: key,
            event_action: "trigger",
            dedup_key: dedupKey,
            payload: {
              summary,
              severity: p.window.byKind.persist > 0 ? "critical" : "error",
              source: process.env.HOSTNAME ?? "api-server",
              component: "moderation-queue",
              class: "moderation_job_failure",
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
    if (!sgMailInitialized) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      sgMailInitialized = true;
    }
    const from =
      process.env.OPS_ALERT_FROM_EMAIL ??
      process.env.FROM_EMAIL ??
      "noreply@buildtestscale.com";
    const minutes = Math.round(p.windowMs / 60000);
    const subject =
      p.kind === "fire"
        ? "[ALERT] Background moderation jobs are failing"
        : "[RESOLVED] Background moderation jobs recovered";
    const text =
      p.kind === "fire"
        ? [
            `The background moderation queue has failed ${p.window.totalCount} time(s) in the last ${minutes} minute(s),`,
            `crossing the configured threshold of ${p.threshold}.`,
            "",
            `In-window breakdown: ${describeKindBreakdown(p.window)}.`,
            p.window.byKind.persist > 0
              ? "WARNING: 'persist' failures mean known-bad posts are still publicly active because the DB write to shadow-hide them threw."
              : "All in-window failures were 'engine' (evaluator) errors — flagged content may have slipped through unevaluated.",
            "",
            `Most recent failure: ${p.window.lastAt ?? "n/a"} (${p.window.lastKind ?? "?"}) — ${p.window.lastError ?? "no detail"}.`,
            `Cumulative since process start: ${p.cumulative.totalCount} (engine: ${p.cumulative.byKind.engine}, persist: ${p.cumulative.byKind.persist}).`,
            "",
            "Open /admin/system and check the 'Background moderation failures' panel.",
          ].join("\n")
        : [
            "The background moderation queue has been quiet for the recovery window —",
            "no new failures observed. Marking the alert resolved.",
            "",
            `Cumulative since process start: ${p.cumulative.totalCount}.`,
            "Confirm via /admin/system.",
          ].join("\n");
    await sgMail.send({ to, from, subject, text });
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
        ? `:rotating_light: *Background moderation jobs are failing* — ${p.window.totalCount} failure(s) in last ${minutes}m (threshold ${p.threshold}). Breakdown: ${describeKindBreakdown(p.window)}. Check /admin/system.`
        : `:white_check_mark: *Background moderation jobs recovered* — no new failures in the last few minutes. Cumulative since start: ${p.cumulative.totalCount}.`;
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

export function __setModerationFailureAlerterDeliveriesForTests(
  overrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null,
): void {
  deliveryOverrides = overrides;
}

export function __resetModerationFailureAlerterForTests(): void {
  alertState.alerting = false;
  alertState.lastFireEvaluatedAt = null;
  alertState.lastSeenWindowTotal = 0;
  alertState.lastInWindowFailureAt = null;
  alertState.lastFireAt = {};
  alertState.lastClearAt = {};
  deliveryOverrides = null;
}

async function dispatchAll(
  payload: ModerationFailureAlertPayload,
): Promise<DeliveryResult[]> {
  const lastMap = payload.kind === "fire" ? alertState.lastFireAt : alertState.lastClearAt;
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
      if (result.ok && !result.skipped) {
        lastMap[dc] = payload.now;
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[ModerationFailureAlerter] ${dc} ${payload.kind} failed:`,
        err,
      );
      return { channel: dc, ok: false, reason };
    }
  });
  return Promise.all(promises);
}

/**
 * Read the current rolling-window failure stats and dispatch any
 * state-transition alerts. Safe to call frequently — transitions are
 * gated by the `alerting` flag and deliveries are throttled per channel.
 *
 * Pulls the threshold/window from the admin Settings DB (with defaults)
 * on every call so a save in the UI is honored on the next poll without
 * needing a restart. Loading the config itself degrades to defaults on
 * a DB error so a flaky DB can't disable the alerter entirely.
 */
export async function evaluateModerationFailureAlert(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  let threshold = MODERATION_FAILURE_ALERT_DEFAULTS.threshold;
  let windowMinutes = MODERATION_FAILURE_ALERT_DEFAULTS.windowMinutes;
  try {
    const cfg = await getModerationFailureAlertConfig();
    threshold = cfg.threshold;
    windowMinutes = cfg.windowMinutes;
  } catch (err) {
    console.error("[ModerationFailureAlerter] Failed to load config, using defaults:", err);
  }
  const windowMs = windowMinutes * 60 * 1000;
  // Read the cluster-wide aggregate so a slow-burn outage that spreads
  // failures across replicas still crosses threshold on any single pod's
  // evaluation. Falls back to the local in-memory snapshot if Redis is
  // unavailable (handled inside the aggregator).
  const window = await getModerationFailuresInWindowAggregated(windowMs, now);
  const cumulative = getModerationFailureCumulativeStats();

  if (window.totalCount > alertState.lastSeenWindowTotal) {
    alertState.lastInWindowFailureAt = now;
  }
  alertState.lastSeenWindowTotal = window.totalCount;

  // Fire when the rolling window is at or above threshold. Re-evaluations
  // while still alerting also call dispatch so a sustained outage gets one
  // page per throttle window (the per-channel throttle suppresses the rest).
  if (window.totalCount >= threshold) {
    alertState.alerting = true;
    alertState.lastFireEvaluatedAt = now;
    return dispatchAll({
      kind: "fire",
      now,
      threshold,
      windowMs,
      window,
      cumulative,
    });
  }

  // Auto-clear: we're alerting, the window has dropped back below
  // threshold, AND no new failures have arrived for the recovery window.
  // The dual check matters because a slow trickle could keep the window
  // total just under threshold for hours — without the quiet-time check
  // we'd resolve the page while failures are still happening.
  const quietFor =
    alertState.lastInWindowFailureAt !== null
      ? now - alertState.lastInWindowFailureAt
      : Infinity;
  if (alertState.alerting && quietFor >= getRecoveryWindowMs()) {
    alertState.alerting = false;
    return dispatchAll({
      kind: "clear",
      now,
      threshold,
      windowMs,
      window,
      cumulative,
    });
  }

  return [];
}

/**
 * Public read-only view of the alerter's current state. Surfaced by the
 * admin System Health endpoint so the page can render "currently paging"
 * without re-deriving the transition logic.
 */
export function getModerationFailureAlertingState(): {
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

// ---------------------------------------------------------------------------
// Pod-silent alerting
// ---------------------------------------------------------------------------
//
// A pod that previously reported moderation activity but has since gone
// silent for longer than the staleness threshold could have stopped running
// moderation entirely — letting flag-worthy posts stay publicly live with no
// one watching. The System Health page already flags these "stale" pods
// visually, but that only helps an admin who happens to be looking. This path
// pages on-call automatically when a previously-reporting pod goes silent,
// and clears when the pod resumes reporting or its per-pod Redis key TTLs out
// (so its instance disappears from the cluster-wide aggregate entirely).
//
// Staleness is computed exactly as the System Health card does
// (`SystemHealth.tsx`): a pod is silent when it carries no in-window failures
// (totalCount === 0) yet its most recent report (`lastAt`) is older than
// twice the configured rolling window. The 2× factor matches the dashboard so
// the page and the alert never disagree about which pods are stale.

export interface ModerationPodSilentAlertPayload {
  kind: AlertKind;
  now: number;
  /** Stable identifier of the pod that went silent. */
  instanceId: string;
  /** Staleness threshold (ms) in force at transition time (= 2 × windowMs). */
  staleThresholdMs: number;
  /** Rolling window length (ms) the staleness threshold derives from. */
  windowMs: number;
  /** ISO of the pod's most recent report at transition time, or null. */
  lastAt: string | null;
  /**
   * Whether the pod is still present in the cluster-wide aggregate. On a
   * "clear", `false` means the pod's Redis key TTL'd out (the instance is
   * gone) rather than the pod resuming reporting.
   */
  present: boolean;
}

type PodSilentDeliveryFn = (
  payload: ModerationPodSilentAlertPayload,
) => Promise<DeliveryResult>;

interface PodSilentState {
  alerting: boolean;
  lastFireAt: Partial<Record<DeliveryChannel, number>>;
  lastClearAt: Partial<Record<DeliveryChannel, number>>;
}

const podSilentStates = new Map<string, PodSilentState>();

let podSilentSgMailInitialized = false;

const podSilentDefaultDeliveries: Record<DeliveryChannel, PodSilentDeliveryFn> = {
  pagerduty: async (p) => {
    const key = process.env.PAGERDUTY_INTEGRATION_KEY;
    if (!key) {
      return { channel: "pagerduty", ok: true, skipped: true, reason: "not_configured" };
    }
    // Per-pod dedup key so each silent pod is its own incident — a second
    // pod going quiet shouldn't fold into (or auto-resolve) the first pod's
    // page.
    const dedupKey = `moderation-pod-silent:${p.instanceId}`;
    const minutes = Math.round(p.staleThresholdMs / 60000);
    const summary = `Moderation pod ${p.instanceId} has gone silent — no moderation report in over ${minutes}m (2× the rolling window). It may have stopped running moderation, leaving flag-worthy posts live.`;
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
              component: "moderation-queue",
              class: "moderation_pod_silent",
              custom_details: {
                instanceId: p.instanceId,
                staleThresholdMinutes: minutes,
                windowMinutes: Math.round(p.windowMs / 60000),
                lastReportAt: p.lastAt,
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
    if (!podSilentSgMailInitialized) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      podSilentSgMailInitialized = true;
    }
    const from =
      process.env.OPS_ALERT_FROM_EMAIL ??
      process.env.FROM_EMAIL ??
      "noreply@buildtestscale.com";
    const minutes = Math.round(p.staleThresholdMs / 60000);
    const subject =
      p.kind === "fire"
        ? `[ALERT] Moderation pod ${p.instanceId} has gone silent`
        : `[RESOLVED] Moderation pod ${p.instanceId} resumed reporting`;
    const text =
      p.kind === "fire"
        ? [
            `Moderation pod ${p.instanceId} previously reported moderation activity but has not reported in over ${minutes} minute(s) (2× the rolling window).`,
            "A pod that silently stops running moderation lets flag-worthy posts stay publicly live with nobody watching.",
            "",
            `Last report: ${p.lastAt ?? "n/a"}.`,
            "",
            "Open /admin/system and check the 'Background moderation failures' panel — the pod will be flagged 'stale' in the per-pod breakdown.",
          ].join("\n")
        : [
            p.present
              ? `Moderation pod ${p.instanceId} has resumed reporting — the silence has cleared.`
              : `Moderation pod ${p.instanceId} has dropped out of the cluster (its per-pod key TTL'd out of Redis); clearing the silence alert.`,
            "",
            "Confirm via /admin/system.",
          ].join("\n");
    await sgMail.send({ to, from, subject, text });
    return { channel: "email", ok: true };
  },

  slack: async (p) => {
    const url = process.env.OPS_ALERT_SLACK_WEBHOOK_URL;
    if (!url) {
      return { channel: "slack", ok: true, skipped: true, reason: "not_configured" };
    }
    const minutes = Math.round(p.staleThresholdMs / 60000);
    const text =
      p.kind === "fire"
        ? `:rotating_light: *Moderation pod has gone silent* — \`${p.instanceId}\` hasn't reported in over ${minutes}m (2× the rolling window). It may have stopped running moderation. Check /admin/system.`
        : p.present
          ? `:white_check_mark: *Moderation pod resumed reporting* — \`${p.instanceId}\` is reporting again.`
          : `:white_check_mark: *Moderation pod dropped out* — \`${p.instanceId}\` TTL'd out of the cluster; clearing the silence alert.`;
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

let podSilentDeliveryOverrides: Partial<Record<DeliveryChannel, PodSilentDeliveryFn>> | null = null;

export function __setModerationPodSilentAlerterDeliveriesForTests(
  overrides: Partial<Record<DeliveryChannel, PodSilentDeliveryFn>> | null,
): void {
  podSilentDeliveryOverrides = overrides;
}

export function __resetModerationPodSilentAlerterForTests(): void {
  podSilentStates.clear();
  podSilentDeliveryOverrides = null;
}

/**
 * A pod is "silent" when it has no in-window failures but its last report is
 * older than 2× the rolling window. The actual test is `isPodStale` in
 * `@workspace/moderation-shared` — the single source of truth the System
 * Health card (`SystemHealth.tsx`) also consumes — so the page and the
 * page-on-call can never disagree about which pods are stale.
 */
function isPodSilent(
  pod: ModerationFailurePodStats,
  nowMs: number,
  staleThresholdMs: number,
): boolean {
  return isPodStale(pod, nowMs, staleThresholdMs);
}

async function dispatchPodSilentAll(
  payload: ModerationPodSilentAlertPayload,
  state: PodSilentState,
): Promise<DeliveryResult[]> {
  const lastMap = payload.kind === "fire" ? state.lastFireAt : state.lastClearAt;
  const throttleMs = getNotificationThrottleMs();
  const promises: Promise<DeliveryResult>[] = (
    ["pagerduty", "email", "slack"] as const
  ).map(async (dc) => {
    const last = lastMap[dc] ?? 0;
    if (last > 0 && payload.now - last < throttleMs) {
      return { channel: dc, ok: true, skipped: true, reason: "throttled" };
    }
    const fn = podSilentDeliveryOverrides?.[dc] ?? podSilentDefaultDeliveries[dc];
    try {
      const result = await fn(payload);
      if (result.ok && !result.skipped) {
        lastMap[dc] = payload.now;
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[ModerationPodSilentAlerter] ${dc} ${payload.kind} failed:`,
        err,
      );
      return { channel: dc, ok: false, reason };
    }
  });
  return Promise.all(promises);
}

/**
 * Detect pods that have gone silent (or recovered) and dispatch per-pod
 * on-call pages. Reads the cluster-wide aggregate so silence is judged
 * across the whole cluster, not just the local pod.
 *
 * State machine (per pod):
 *   - Fire once when a previously-reporting pod first crosses the staleness
 *     threshold. Re-evaluations while still silent do NOT re-page (the
 *     incident stays open via its stable PagerDuty dedup key); the
 *     per-channel throttle additionally caps a flapping pod.
 *   - Clear when the pod resumes reporting (a fresh report lands inside the
 *     threshold or a new in-window failure arrives) OR its per-pod key TTLs
 *     out of Redis so the instance disappears from the aggregate.
 *
 * The `alerting` flag is flipped before awaiting dispatch so a concurrent
 * evaluation (poll + a notifications-bell kick) can't double-page the same
 * transition.
 */
export async function evaluateModerationPodSilentAlert(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  let windowMinutes = MODERATION_FAILURE_ALERT_DEFAULTS.windowMinutes;
  try {
    const cfg = await getModerationFailureAlertConfig();
    windowMinutes = cfg.windowMinutes;
  } catch (err) {
    console.error(
      "[ModerationPodSilentAlerter] Failed to load config, using defaults:",
      err,
    );
  }
  const windowMs = windowMinutes * 60 * 1000;
  const staleThresholdMs = staleThresholdMsForWindow(windowMs);
  const window = await getModerationFailuresInWindowAggregated(windowMs, now);
  const pods = window.pods;
  const presentIds = new Set(pods.map((p) => p.instanceId));
  const results: DeliveryResult[] = [];

  // Fire for pods that have newly gone silent.
  for (const pod of pods) {
    if (!isPodSilent(pod, now, staleThresholdMs)) continue;
    let state = podSilentStates.get(pod.instanceId);
    if (!state) {
      state = { alerting: false, lastFireAt: {}, lastClearAt: {} };
      podSilentStates.set(pod.instanceId, state);
    }
    if (state.alerting) continue;
    state.alerting = true;
    const dispatched = await dispatchPodSilentAll(
      {
        kind: "fire",
        now,
        instanceId: pod.instanceId,
        staleThresholdMs,
        windowMs,
        lastAt: pod.lastAt,
        present: true,
      },
      state,
    );
    results.push(...dispatched);
  }

  // Clear for pods we're alerting on that have recovered or TTL'd out.
  for (const [instanceId, state] of podSilentStates) {
    if (!state.alerting) continue;
    const pod = pods.find((p) => p.instanceId === instanceId);
    const stillSilent = pod ? isPodSilent(pod, now, staleThresholdMs) : false;
    if (stillSilent) continue;
    state.alerting = false;
    const present = presentIds.has(instanceId);
    const dispatched = await dispatchPodSilentAll(
      {
        kind: "clear",
        now,
        instanceId,
        staleThresholdMs,
        windowMs,
        lastAt: pod?.lastAt ?? null,
        present,
      },
      state,
    );
    results.push(...dispatched);
    // A pod that TTL'd out of the cluster will never return under the same
    // (random-suffixed) instance id, so drop its state. A pod that merely
    // resumed keeps its state so its per-channel throttle timestamps survive
    // a future relapse.
    if (!present) podSilentStates.delete(instanceId);
  }

  return results;
}

/**
 * Read-only view of which pods the silence alerter is currently paging on.
 * Exposed for tests and any future System Health surfacing.
 */
export function getModerationPodSilentAlertingState(): {
  alertingPodIds: string[];
} {
  const alertingPodIds: string[] = [];
  for (const [id, state] of podSilentStates) {
    if (state.alerting) alertingPodIds.push(id);
  }
  return { alertingPodIds };
}

let pollHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

export function startModerationFailureAlerter(): void {
  if (started) return;
  started = true;
  evaluateModerationFailureAlert().catch((err) => {
    console.error("[ModerationFailureAlerter] startup error:", err);
  });
  evaluateModerationPodSilentAlert().catch((err) => {
    console.error("[ModerationPodSilentAlerter] startup error:", err);
  });
  if (POLL_MS > 0) {
    pollHandle = setInterval(() => {
      evaluateModerationFailureAlert().catch((err) => {
        console.error("[ModerationFailureAlerter] poll error:", err);
      });
      evaluateModerationPodSilentAlert().catch((err) => {
        console.error("[ModerationPodSilentAlerter] poll error:", err);
      });
    }, POLL_MS);
    pollHandle.unref?.();
  }
}

export function stopModerationFailureAlerter(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  started = false;
}
