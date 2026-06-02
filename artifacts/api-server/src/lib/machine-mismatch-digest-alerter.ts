/**
 * Pages on-call when the daily Machine-order mismatch digest (see
 * `machine-mismatch-daily-digest.ts`) quietly stops firing.
 *
 * Background: task #522 surfaces the digest's last-run heartbeat on the admin
 * System Health page and visually flags a stale (> 2× interval) or failed run.
 * But admins only see that if they happen to open the page — a digest job that
 * silently dies (crash loop, stuck interval, repeated send failure) goes
 * unnoticed and ops simply stops getting the reconciliation nudge. This
 * alerter mirrors the abuse-rate-limit-cleanup / retention-sweep watchdog
 * pattern so a quietly-broken digest pages on-call proactively.
 *
 * Delivery plumbing (PagerDuty / ops email / Slack), the per-channel throttle,
 * the SendGrid lazy init, and the audit-log hook are all owned by the shared
 * `oncall-dispatcher`. Destinations are read fresh from `oncall-settings` at
 * dispatch time so admin edits via the Settings UI take effect without a
 * restart.
 *
 * Behavior:
 *   - Polls periodically (default 1h). Reads the digest heartbeat via
 *     `getMachineMismatchDigestStatus()` and considers the digest unhealthy
 *     when EITHER the heartbeat is older than 2× the configured run interval
 *     OR the most recent run's outcome is "failed".
 *   - On the healthy → unhealthy transition, dispatches a "fire" to every
 *     configured on-call destination.
 *   - On the unhealthy → healthy transition, dispatches an "all clear".
 *   - Each delivery channel is throttled per kind to at most one notification
 *     per MACHINE_MISMATCH_DIGEST_ALERT_THROTTLE_MS (default 1h) so a job
 *     stuck unhealthy can't re-page every poll.
 *   - One audit-log row is written per delivery attempt (including skipped /
 *     throttled / failed). Action type `machine_mismatch_digest_alert`,
 *     entity type `alert` — same shape as the queue-fallback /
 *     machine-mismatch alerters, so the System Health alert timeline picks
 *     them up via its inArray filter without any extra plumbing.
 *   - PagerDuty incidents use a stable dedup_key
 *     (`machine-mismatch-digest:heartbeat`) so re-triggers fold into the
 *     existing incident and a "resolve" event auto-closes it.
 *
 * "Never run yet" handling: the digest heartbeat is in-process memory and the
 * scheduled job only fires on its interval (not on startup), so `lastRanAt`
 * is null for a while after every restart. We fall back to a module-load
 * baseline for the staleness clock — if the process has been up longer than
 * 2 intervals without a single digest run landing, that is itself a
 * regression worth paging on, exactly as `abuse-rate-limit-cleanup` does for
 * its sweep.
 *
 * When the digest job is disabled entirely (`MACHINE_MISMATCH_DIGEST_INTERVAL_MS=0`,
 * which makes `startMachineMismatchDigestJob` a no-op) the evaluator is a
 * no-op too — there is no heartbeat to watch.
 */

import { logAuditEvent } from "./audit-log";
import { getOnCallDestinations } from "./oncall-settings";
import {
  getMachineMismatchDigestStatus,
  type MachineMismatchDigestStatus,
} from "./machine-mismatch-daily-digest";
import {
  createInMemoryThrottleStore,
  createOnCallDispatcher,
  createPollRunner,
  parseEnvInt,
  type AlertKind,
  type AlertMessages,
  type DeliveryChannel,
  type DeliveryFn,
  type DeliveryResult,
} from "./oncall-dispatcher";

export type { DeliveryChannel, DeliveryResult };

/**
 * Audit log action / entity types used to record on-call alert delivery
 * attempts for this alerter. Exported so the admin filters, the System Health
 * alert timeline (which inArray's across all alerter action types), and tests
 * can refer to a single source of truth.
 */
export const MACHINE_MISMATCH_DIGEST_ALERT_ACTION_TYPE =
  "machine_mismatch_digest_alert";
export const MACHINE_MISMATCH_DIGEST_ALERT_ENTITY_TYPE = "alert";
/** Stable entityId so admins can group / filter alert rows for this alerter. */
export const MACHINE_MISMATCH_DIGEST_ALERT_ENTITY_ID =
  "machine_order_mismatch_daily";

export type AlertDeliveryOutcome = "sent" | "failed" | "throttled" | "skipped";

function getNotificationThrottleMs(): number {
  return parseEnvInt(
    "MACHINE_MISMATCH_DIGEST_ALERT_THROTTLE_MS",
    60 * 60 * 1000,
  );
}

// 1 hour by default. The digest interval is 24h and the staleness threshold
// is 48h, so even an hourly poll detects a stuck job well within the window
// while generating negligible load.
const POLL_MS = parseEnvInt(
  "MACHINE_MISMATCH_DIGEST_ALERTER_POLL_MS",
  60 * 60 * 1000,
);

export interface DigestHealth {
  /** True when the heartbeat is older than 2× the configured run interval. */
  stale: boolean;
  /** True when the most recent run's outcome was "failed". */
  failed: boolean;
  /** True when the digest is unhealthy for any reason (stale OR failed). */
  alerting: boolean;
  /** Age of the heartbeat in ms (measured from baseline when never run). */
  ageMs: number;
}

export interface MachineMismatchDigestAlertPayload {
  kind: AlertKind;
  status: MachineMismatchDigestStatus;
  health: DigestHealth;
  now: number;
}

// Baseline used to compute staleness when the digest has not yet reported a
// run. Set at module load — which in production is process start, the same
// moment `startMachineMismatchDigestJob` schedules its first run. If the job
// is supposed to be running but no run lands within 2 intervals of this
// baseline, that is itself a regression worth paging on.
let baselineSince = Date.now();

/**
 * Compute the digest's health from its heartbeat snapshot. Pure so tests and
 * any future admin endpoint can reuse the exact decision the alerter makes.
 */
export function evaluateDigestHealth(
  status: MachineMismatchDigestStatus,
  now: number,
): DigestHealth {
  const referenceTs = status.lastRanAt
    ? Date.parse(status.lastRanAt)
    : baselineSince;
  const ageMs = now - referenceTs;
  const stale = ageMs > 2 * status.intervalMs;
  const failed = status.lastOutcome === "failed";
  return { stale, failed, alerting: stale || failed, ageMs };
}

function buildTriggerSummary(health: DigestHealth): string {
  const reasons: string[] = [];
  if (health.stale) {
    reasons.push("the heartbeat is older than 2× the run interval");
  }
  if (health.failed) {
    reasons.push("the most recent run failed");
  }
  return reasons.length > 0 ? reasons.join(" and ") : "the digest is unhealthy";
}

function describeStatus(status: MachineMismatchDigestStatus): string {
  const parts: string[] = [];
  parts.push(`Last run: ${status.lastRanAt ?? "never"}`);
  parts.push(`Last outcome: ${status.lastOutcome ?? "n/a"}`);
  if (status.lastReason) {
    parts.push(`Reason: ${status.lastReason}`);
  }
  parts.push(`Run interval: ${Math.round(status.intervalMs / 60000)}m`);
  return parts.join(" \u2014 ");
}

function buildMessages(p: MachineMismatchDigestAlertPayload): AlertMessages {
  const dedupKey = "machine-mismatch-digest:heartbeat";
  const trigger = buildTriggerSummary(p.health);

  const summary =
    p.kind === "fire"
      ? `Machine mismatch daily digest is not firing — ${trigger}`
      : "Machine mismatch daily digest recovered — a fresh successful run landed";

  const subject =
    p.kind === "fire"
      ? "[ALERT] Machine mismatch daily digest stopped firing"
      : "[RESOLVED] Machine mismatch daily digest recovered";

  const text =
    p.kind === "fire"
      ? [
          `The daily Machine-order mismatch digest looks broken: ${trigger}.`,
          "Ops will stop receiving the reconciliation nudge until it runs again.",
          "",
          describeStatus(p.status),
          "",
          "Check /admin/system (Machine mismatch digest panel) and the api-server logs.",
        ].join("\n")
      : [
          "The daily Machine-order mismatch digest has reported a fresh successful run; the heartbeat is healthy again.",
          "",
          describeStatus(p.status),
          "",
          "Confirm via /admin/system.",
        ].join("\n");

  const slackText =
    p.kind === "fire"
      ? `:rotating_light: *Machine mismatch daily digest stopped firing* — ${trigger}. Last run: ${p.status.lastRanAt ?? "never"} (outcome: ${p.status.lastOutcome ?? "n/a"}). Check /admin/system.`
      : `:white_check_mark: *Machine mismatch daily digest recovered* — fresh run at ${p.status.lastRanAt ?? "n/a"}.`;

  return {
    pagerduty: {
      dedupKey,
      summary,
      severity: "error",
      component: "integrations.machine",
      class: "machine_mismatch_digest_stale",
      custom_details: {
        stale: p.health.stale,
        failed: p.health.failed,
        lastRanAt: p.status.lastRanAt,
        lastOutcome: p.status.lastOutcome,
        intervalMs: p.status.intervalMs,
        link: "/admin/system",
      },
    },
    email: { subject, text },
    slack: { text: slackText },
  };
}

const throttleStore = createInMemoryThrottleStore();

function classifyOutcome(result: DeliveryResult): AlertDeliveryOutcome {
  if (!result.ok) return "failed";
  if (result.skipped) {
    return result.reason === "throttled" ? "throttled" : "skipped";
  }
  return "sent";
}

function describeAttempt(
  payload: MachineMismatchDigestAlertPayload,
  result: DeliveryResult,
  outcome: AlertDeliveryOutcome,
): string {
  const verb = payload.kind === "fire" ? "fire" : "clear";
  const reasonSuffix = result.reason ? ` (${result.reason})` : "";
  switch (outcome) {
    case "sent":
      return `Sent ${verb} alert via ${result.channel} for Machine mismatch daily digest`;
    case "failed":
      return `Failed to send ${verb} alert via ${result.channel} for Machine mismatch daily digest${reasonSuffix}`;
    case "throttled":
      return `Throttled ${verb} alert via ${result.channel} for Machine mismatch daily digest${reasonSuffix}`;
    case "skipped":
      return `Skipped ${verb} alert via ${result.channel} for Machine mismatch daily digest${reasonSuffix}`;
  }
}

/**
 * Persist a single delivery attempt as an audit row so admins reviewing an
 * incident later can confirm whether on-call was paged, why a channel was
 * skipped, etc. Fire-and-forget — `logAuditEvent` already swallows DB errors
 * so a flaky audit table can never break alert dispatch.
 */
async function recordDeliveryAttempt(
  payload: MachineMismatchDigestAlertPayload,
  result: DeliveryResult,
): Promise<void> {
  const outcome = classifyOutcome(result);
  await logAuditEvent({
    actionType: MACHINE_MISMATCH_DIGEST_ALERT_ACTION_TYPE,
    entityType: MACHINE_MISMATCH_DIGEST_ALERT_ENTITY_TYPE,
    entityId: MACHINE_MISMATCH_DIGEST_ALERT_ENTITY_ID,
    description: describeAttempt(payload, result, outcome),
    metadata: {
      deliveryChannel: result.channel,
      kind: payload.kind,
      outcome,
      reason: result.reason ?? null,
      stale: payload.health.stale,
      failed: payload.health.failed,
      ageMs: payload.health.ageMs,
      lastRanAt: payload.status.lastRanAt,
      lastOutcome: payload.status.lastOutcome,
      intervalMs: payload.status.intervalMs,
    },
  });
}

const dispatcher = createOnCallDispatcher<
  MachineMismatchDigestAlertPayload,
  string
>({
  name: "MachineMismatchDigestAlerter",
  destinations: () => getOnCallDestinations(),
  throttleMs: getNotificationThrottleMs,
  throttleStore,
  throttleKey: (p, dc) => `${p.kind}:${dc}`,
  buildMessages,
  kindOf: (p) => p.kind,
  onDelivery: recordDeliveryAttempt,
});

/** Test-only: replace one or more delivery functions with stubs. */
export function __setMachineMismatchDigestAlerterDeliveriesForTests(
  overrides:
    | Partial<Record<DeliveryChannel, DeliveryFn<MachineMismatchDigestAlertPayload>>>
    | null,
): void {
  dispatcher.setDeliveryOverrides(overrides);
}

/** In-memory transition flag — true while we consider the digest unhealthy. */
let alerting = false;

/**
 * Test-only: reset all alerter state. The optional `now` reseeds the
 * "never run yet" staleness baseline so tests can deterministically place the
 * baseline relative to the timestamps they feed in.
 */
export function __resetMachineMismatchDigestAlerterForTests(
  now: number = Date.now(),
): void {
  alerting = false;
  baselineSince = now;
  throttleStore.reset();
  dispatcher.setDeliveryOverrides(null);
}

/** Test-only: read the current `alerting` flag without mutating it. */
export function __getMachineMismatchDigestAlerterStateForTests(): boolean {
  return alerting;
}

/**
 * Read-only snapshot of the watchdog's current state for the admin System
 * Health page. Reuses the exact `evaluateDigestHealth` decision the poll runs
 * on, plus the in-process `alerting` transition flag so admins can see at a
 * glance whether the watchdog is *currently firing* (has paged on-call and
 * not yet sent an all-clear) versus merely observing an unhealthy heartbeat
 * this instant.
 *
 * `enabled` is false when the digest job — and therefore this watchdog — is
 * turned off (`intervalMs <= 0`), mirroring the no-op short-circuit in
 * `evaluateMachineMismatchDigestAlert`. When disabled there is no heartbeat
 * to watch, so `health` is reported but should be treated as informational.
 */
export interface MachineMismatchDigestWatchdogState {
  /**
   * True while the watchdog considers the digest unhealthy and has dispatched
   * a "fire" that has not yet been cleared. This is the durable transition
   * flag, not a fresh recompute — it answers "is on-call currently paged?".
   */
  firing: boolean;
  /** Health recomputed from the live heartbeat snapshot at `evaluatedAt`. */
  health: DigestHealth;
  /** The underlying digest heartbeat snapshot the health was derived from. */
  status: MachineMismatchDigestStatus;
  /** False when the digest job (and thus the watchdog) is disabled. */
  enabled: boolean;
  /** ISO timestamp at which this snapshot was computed. */
  evaluatedAt: string;
}

export function getMachineMismatchDigestWatchdogState(
  now: number = Date.now(),
): MachineMismatchDigestWatchdogState {
  const status = getMachineMismatchDigestStatus();
  const enabled = status.intervalMs > 0;
  const health = evaluateDigestHealth(status, now);
  return {
    firing: alerting,
    health,
    status,
    enabled,
    evaluatedAt: new Date(now).toISOString(),
  };
}

/**
 * Read the digest heartbeat and dispatch any state-transition alerts (fire on
 * the first detection that the digest has gone unhealthy, clear when a fresh
 * healthy run lands). No-op when the digest job is disabled. Safe to call
 * frequently; transitions are gated by the `alerting` flag and deliveries are
 * throttled.
 *
 * Concurrency: the background poll could in principle overlap with a future
 * on-demand evaluation. The transition flag is flipped synchronously before
 * awaiting dispatch, so a concurrent call that arrives mid-dispatch observes
 * the new state and returns immediately instead of double-paging.
 */
export async function evaluateMachineMismatchDigestAlert(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const status = getMachineMismatchDigestStatus();
  if (status.intervalMs <= 0) {
    return [];
  }
  const health = evaluateDigestHealth(status, now);
  const prev = alerting;
  if (health.alerting && !prev) {
    alerting = true;
    return dispatcher.dispatch({ kind: "fire", status, health, now }, now);
  }
  if (!health.alerting && prev) {
    alerting = false;
    return dispatcher.dispatch({ kind: "clear", status, health, now }, now);
  }
  return [];
}

const runner = createPollRunner({
  name: "MachineMismatchDigestAlerter",
  pollMs: POLL_MS,
  evaluate: () => evaluateMachineMismatchDigestAlert(),
});

/**
 * Start the recovery poll so a stuck digest is detected even if no admin loads
 * the dashboard. Idempotent.
 */
export function startMachineMismatchDigestAlerter(): void {
  runner.start();
}

/** Stop the poll. */
export function stopMachineMismatchDigestAlerter(): void {
  runner.stop();
}
