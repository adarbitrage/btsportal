/**
 * Sends real on-call notifications when the email/SMS queue starts bypassing
 * Redis. Listens to queue-fallback-tracker events for fast "fire" alerts and
 * also polls periodically so it can detect "all clear" recovery (which is
 * passive — events simply age out of the recent window).
 *
 * Delivery channels (each independently optional). Each destination is read
 * fresh from `oncall-settings` at dispatch time, so admin edits via the
 * Settings UI take effect without restarting. Values fall back to env vars
 * for deploys that haven't migrated to the DB store:
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY   (Events API v2 routing key)
 *   - Ops email:  OPS_ALERT_EMAIL             (sent via SendGrid)
 *                 OPS_ALERT_FROM_EMAIL        (defaults to FROM_EMAIL or noreply@buildtestscale.com)
 *                 SENDGRID_API_KEY            (required for the email channel)
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL (incoming webhook URL)
 *
 * Behavior:
 *   - When a queue channel (email/sms) transitions from "no recent fallbacks"
 *     to "has recent fallbacks", we send a "fire" alert on each configured
 *     delivery channel.
 *   - When the queue channel transitions back (no fallbacks within the
 *     recent window), we send an "all clear" alert.
 *   - Each delivery channel is throttled per queue-channel/per-kind to at
 *     most one notification per QUEUE_FALLBACK_NOTIFICATION_THROTTLE_MS
 *     (default 5 minutes), so a flapping outage cannot spam on-call.
 *   - PagerDuty incidents use a stable dedup_key (`queue-fallback:<channel>`)
 *     so re-triggers fold into the existing incident and a "resolve" event
 *     auto-closes it.
 *
 * Multi-instance correctness:
 *   - The "currently alerting" decision is sourced from the DB-backed
 *     `getQueueFallbackStatsFromDb()` so every pod observes the same
 *     cluster-wide truth (a fallback recorded on pod A is visible to pod B).
 *   - The alerting flag and per-(queue,delivery,kind) throttle slots live in
 *     Redis (see `queue-fallback-alerter-state.ts`) so transitions are
 *     observed exactly once across the cluster and the throttle cap holds
 *     globally — not per pod. With Redis unavailable we fall back to local
 *     in-memory state, matching pre-multi-instance behavior.
 */

import sgMail from "@sendgrid/mail";
import { logAuditEvent } from "./audit-log";
import {
  getQueueFallbackStats,
  getQueueFallbackStatsFromDb,
  setQueueFallbackListener,
  type QueueChannel,
  type QueueFallbackStats,
} from "./queue-fallback-tracker";
import { getOnCallDestinations } from "./oncall-settings";
import {
  compareAndSetAlertingState,
  releaseThrottleSlot,
  tryClaimThrottleSlot,
  __resetQueueFallbackAlerterStateForTests,
  type AlertKind,
  type DeliveryChannel,
} from "./queue-fallback-alerter-state";

export type { AlertKind, DeliveryChannel };

/**
 * Audit log action / entity types used to record on-call alert delivery
 * attempts. Exported so the cleanup job, admin filters, and tests can refer
 * to a single source of truth.
 */
export const QUEUE_FALLBACK_ALERT_ACTION_TYPE = "queue_fallback_alert";
export const QUEUE_FALLBACK_ALERT_ENTITY_TYPE = "alert";

/**
 * Outcome of a single delivery attempt, derived from the DeliveryResult.
 * Stored on the audit row so admins can filter / count without parsing the
 * description string.
 *
 *   - sent:      delivery actually went out
 *   - failed:    provider returned an error or threw
 *   - throttled: suppressed by the per-delivery throttle window
 *   - skipped:   no provider configured (or other intentional no-op)
 */
export type AlertDeliveryOutcome = "sent" | "failed" | "throttled" | "skipped";

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getNotificationThrottleMs(): number {
  return parseEnvInt("QUEUE_FALLBACK_NOTIFICATION_THROTTLE_MS", 5 * 60 * 1000);
}
const POLL_MS = parseEnvInt("QUEUE_FALLBACK_ALERTER_POLL_MS", 60 * 1000);

export interface AlertPayload {
  queueChannel: QueueChannel;
  kind: AlertKind;
  stats: QueueFallbackStats;
  now: number;
  /** Set by `sendOnCallTestAlert` so deliveries can mark themselves as a test
   *  drill (different PagerDuty dedup key, "[TEST]" subject prefix). Real
   *  alerts leave it undefined. */
  isTest?: boolean;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  ok: boolean;
  /** True if no notification was attempted (e.g. provider not configured or throttled). */
  skipped?: boolean;
  reason?: string;
}

/**
 * Result of a per-channel reachability probe (the lightweight "did the value
 * the admin just typed actually work?" check fired from the Settings save
 * flow). Distinct from `DeliveryResult` because probes:
 *   - are not associated with an `AlertPayload` (no queue stats / no kind)
 *   - take the destination value as a direct argument (so we can probe a
 *     freshly saved value before re-reading it from storage)
 *   - can themselves be skipped (e.g. email probe when SENDGRID_API_KEY is
 *     not configured) without that being a failure of the saved value
 */
export interface ProbeResult {
  ok: boolean;
  /** True when the probe couldn't actually exercise the destination (e.g.
   *  no SendGrid API key configured, so we couldn't verify the email). The
   *  saved value is still stored; the UI just can't show a green check. */
  skipped?: boolean;
  reason?: string;
}

type DeliveryFn = (payload: AlertPayload) => Promise<DeliveryResult>;

/** Per-channel probe signatures. Each takes the *value to probe* directly so
 *  the save flow can verify the value the admin just typed without a
 *  round-trip through storage. */
export type PagerDutyProbeFn = (key: string) => Promise<ProbeResult>;
export type EmailProbeFn = (to: string) => Promise<ProbeResult>;
export type SlackProbeFn = (url: string) => Promise<ProbeResult>;

let sgMailInitialized = false;

const defaultDeliveries: Record<DeliveryChannel, DeliveryFn> = {
  pagerduty: async (p) => {
    const dest = await getOnCallDestinations();
    const key = dest.pagerdutyIntegrationKey;
    if (!key) {
      return { channel: "pagerduty", ok: true, skipped: true, reason: "not_configured" };
    }
    // Test alerts use a separate dedup key so the synthetic fire+clear pair
    // can't collide with a real, ongoing incident in PagerDuty.
    const dedupKey = p.isTest
      ? `queue-fallback-test:${p.queueChannel}`
      : `queue-fallback:${p.queueChannel}`;
    const minutes = Math.round(p.stats.recentWindowMs / 60000);
    const recent = p.stats[p.queueChannel].recentCount;
    const summary = p.isTest
      ? `[TEST] On-call routing test for ${p.queueChannel.toUpperCase()} queue`
      : `${p.queueChannel.toUpperCase()} queue bypassing Redis — ${recent} direct-send fallback(s) in last ${minutes}m`;
    const body = p.kind === "fire"
      ? {
          routing_key: key,
          event_action: "trigger",
          dedup_key: dedupKey,
          payload: {
            summary,
            severity: p.isTest ? "info" : "error",
            source: process.env.HOSTNAME ?? "api-server",
            component: "communication-queue",
            group: p.queueChannel,
            class: p.isTest ? "queue_fallback_test" : "queue_fallback",
            custom_details: { ...p.stats, isTest: p.isTest === true },
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
    const dest = await getOnCallDestinations();
    const to = dest.opsAlertEmail;
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
    const minutes = Math.round(p.stats.recentWindowMs / 60000);
    const ch = p.stats[p.queueChannel];
    const testPrefix = p.isTest ? "[TEST] " : "";
    const subject = p.kind === "fire"
      ? `${testPrefix}[ALERT] ${p.queueChannel.toUpperCase()} queue is bypassing Redis`
      : `${testPrefix}[RESOLVED] ${p.queueChannel.toUpperCase()} queue back to normal`;
    const intro = p.isTest
      ? "This is a synthetic on-call routing test fired from the admin Settings page; no action is required.\n\n"
      : "";
    const text = intro + (p.kind === "fire"
      ? [
          `The ${p.queueChannel} queue had ${ch.recentCount} direct-send fallback(s) in the last ${minutes} minute(s).`,
          `Last fallback: ${ch.lastAt ?? "n/a"}`,
          `1h total: ${ch.hourCount}, 24h total: ${ch.dayCount}`,
          ``,
          `Check Redis health and the communication worker.`,
        ].join("\n")
      : [
          `The ${p.queueChannel} queue has had no direct-send fallbacks in the last ${minutes} minute(s).`,
          `24h total still on record: ${ch.dayCount}.`,
          ``,
          `Marking the alert resolved.`,
        ].join("\n"));
    await sgMail.send({ to, from, subject, text });
    return { channel: "email", ok: true };
  },

  slack: async (p) => {
    const dest = await getOnCallDestinations();
    const url = dest.opsAlertSlackWebhookUrl;
    if (!url) {
      return { channel: "slack", ok: true, skipped: true, reason: "not_configured" };
    }
    const minutes = Math.round(p.stats.recentWindowMs / 60000);
    const ch = p.stats[p.queueChannel];
    const testPrefix = p.isTest ? "[TEST] " : "";
    const text = p.kind === "fire"
      ? `${testPrefix}:rotating_light: *${p.queueChannel.toUpperCase()} queue bypassing Redis* — ${ch.recentCount} direct-send fallback(s) in the last ${minutes}m. Last at ${ch.lastAt ?? "n/a"}. Check Redis.`
      : `${testPrefix}:white_check_mark: *${p.queueChannel.toUpperCase()} queue recovered* — no fallbacks in the last ${minutes}m.`;
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

/** Test-only: replace one or more delivery functions with stubs. */
export function __setQueueFallbackAlerterDeliveriesForTests(
  overrides: Partial<Record<DeliveryChannel, DeliveryFn>> | null,
): void {
  deliveryOverrides = overrides;
}

/**
 * Per-channel reachability probes. Lighter-weight than the full fire+clear
 * test alert: each probe just confirms the value the admin saved is accepted
 * by the corresponding provider. Used by the on-call destinations save flow
 * so a typo'd Slack URL or revoked PagerDuty key surfaces inline instead of
 * waiting for the next real incident.
 *
 * Implementation notes:
 *   - PagerDuty: send a `trigger` event (severity=info, low-noise summary)
 *     followed by an immediate `resolve` with the same dedup key, so the
 *     synthetic incident auto-closes. PagerDuty rejects unknown / revoked
 *     routing keys at trigger time, so a 4xx response is the failure signal.
 *   - Email: send a one-line "test from BTS admin" message via SendGrid.
 *     SendGrid validates the recipient domain on send and returns 4xx if
 *     the address is malformed. When `SENDGRID_API_KEY` is unset we report
 *     `skipped` rather than a failure — the saved address itself isn't bad,
 *     we just can't reach SendGrid.
 *   - Slack: POST a "configuration test" message to the webhook URL. Slack
 *     returns 200 + body "ok" on success and 4xx with a short error string
 *     ("invalid_token", "no_service") for revoked / typo'd webhooks.
 */
const defaultProbes = {
  pagerduty: (async (key: string): Promise<ProbeResult> => {
    if (!key) return { ok: false, reason: "missing_key" };
    const dedupKey = "oncall-config-probe";
    const summary = "BTS on-call destination probe (auto-resolves)";
    const triggerBody = {
      routing_key: key,
      event_action: "trigger" as const,
      dedup_key: dedupKey,
      payload: {
        summary,
        severity: "info" as const,
        source: process.env.HOSTNAME ?? "api-server",
        component: "communication-queue",
        class: "oncall_config_probe",
      },
    };
    const triggerRes = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(triggerBody),
    });
    if (!triggerRes.ok) {
      return { ok: false, reason: `http_${triggerRes.status}` };
    }
    // Best-effort resolve so the probe doesn't leave a dangling test
    // incident in PagerDuty. A failure here doesn't invalidate the probe
    // (the routing key was already proven accepted by the trigger above),
    // so we just log and move on.
    try {
      const resolveRes = await fetch("https://events.pagerduty.com/v2/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing_key: key,
          event_action: "resolve",
          dedup_key: dedupKey,
        }),
      });
      if (!resolveRes.ok) {
        console.warn(
          `[QueueFallbackAlerter] PagerDuty probe resolve returned http_${resolveRes.status}; trigger was accepted so probe still ok`,
        );
      }
    } catch (err) {
      console.warn("[QueueFallbackAlerter] PagerDuty probe resolve failed:", err);
    }
    return { ok: true };
  }) satisfies PagerDutyProbeFn,

  email: (async (to: string): Promise<ProbeResult> => {
    if (!to) return { ok: false, reason: "missing_email" };
    if (!process.env.SENDGRID_API_KEY) {
      return { ok: true, skipped: true, reason: "sendgrid_not_configured" };
    }
    if (!sgMailInitialized) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      sgMailInitialized = true;
    }
    const from =
      process.env.OPS_ALERT_FROM_EMAIL ??
      process.env.FROM_EMAIL ??
      "noreply@buildtestscale.com";
    await sgMail.send({
      to,
      from,
      subject: "[TEST] BTS on-call destination probe",
      text: "test from BTS admin: this confirms the on-call email destination is reachable. No action required.",
    });
    return { ok: true };
  }) satisfies EmailProbeFn,

  slack: (async (url: string): Promise<ProbeResult> => {
    if (!url) return { ok: false, reason: "missing_url" };
    const text =
      ":wrench: BTS on-call destination configuration test — webhook reachable. (You can ignore this message.)";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}` };
    }
    return { ok: true };
  }) satisfies SlackProbeFn,
};

interface ProbeOverrides {
  pagerduty?: PagerDutyProbeFn;
  email?: EmailProbeFn;
  slack?: SlackProbeFn;
}

let probeOverrides: ProbeOverrides | null = null;

/** Test-only: replace one or more probe functions with stubs. */
export function __setOnCallProbesForTests(overrides: ProbeOverrides | null): void {
  probeOverrides = overrides;
}

/**
 * Probe a freshly saved PagerDuty integration key. Wraps the underlying
 * fetch so unexpected throws (network errors, DNS failures) become a normal
 * `{ok:false, reason}` result instead of bubbling up and 500-ing the save.
 */
export async function probePagerDutyDestination(key: string): Promise<ProbeResult> {
  const fn = probeOverrides?.pagerduty ?? defaultProbes.pagerduty;
  try {
    return await fn(key);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}

/** Probe a freshly saved ops-alert email address. See the note above. */
export async function probeEmailDestination(to: string): Promise<ProbeResult> {
  const fn = probeOverrides?.email ?? defaultProbes.email;
  try {
    return await fn(to);
  } catch (err) {
    // SendGrid surfaces address-rejected errors as exceptions with a
    // `response.body.errors[]` payload. We flatten that to the first
    // message string when available so the UI can show "address rejected"
    // instead of the raw stack trace.
    const reason = sendgridErrorMessage(err) ?? (err instanceof Error ? err.message : String(err));
    return { ok: false, reason };
  }
}

/** Probe a freshly saved Slack incoming-webhook URL. See the note above. */
export async function probeSlackDestination(url: string): Promise<ProbeResult> {
  const fn = probeOverrides?.slack ?? defaultProbes.slack;
  try {
    return await fn(url);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}

function sendgridErrorMessage(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const response = (err as { response?: { body?: { errors?: Array<{ message?: string }> } } }).response;
  const first = response?.body?.errors?.[0]?.message;
  return typeof first === "string" && first.length > 0 ? first : null;
}

/** Test-only: reset all alerter state (in-memory shared-state fallback included). */
export function __resetQueueFallbackAlerterForTests(): void {
  __resetQueueFallbackAlerterStateForTests();
  deliveryOverrides = null;
  probeOverrides = null;
}

/**
 * Map a `DeliveryResult` to the coarse outcome bucket we record on the
 * audit row. Keeping this derivation in one place means the description
 * string and `metadata.outcome` always agree.
 */
function classifyOutcome(result: DeliveryResult): AlertDeliveryOutcome {
  if (!result.ok) return "failed";
  if (result.skipped) {
    return result.reason === "throttled" ? "throttled" : "skipped";
  }
  return "sent";
}

function describeAttempt(
  payload: AlertPayload,
  result: DeliveryResult,
  outcome: AlertDeliveryOutcome,
): string {
  const verb = payload.kind === "fire" ? "fire" : "clear";
  const reasonSuffix = result.reason ? ` (${result.reason})` : "";
  switch (outcome) {
    case "sent":
      return `Sent ${verb} alert via ${result.channel} for ${payload.queueChannel} queue`;
    case "failed":
      return `Failed to send ${verb} alert via ${result.channel} for ${payload.queueChannel} queue${reasonSuffix}`;
    case "throttled":
      return `Throttled ${verb} alert via ${result.channel} for ${payload.queueChannel} queue${reasonSuffix}`;
    case "skipped":
      return `Skipped ${verb} alert via ${result.channel} for ${payload.queueChannel} queue${reasonSuffix}`;
  }
}

/**
 * Persist a single delivery attempt as an audit log row so admins reviewing
 * an incident later can confirm whether on-call was paged, why an attempt
 * was skipped, etc. Fire-and-forget — `logAuditEvent` already swallows DB
 * errors so a flaky audit table can never break alert dispatch.
 */
async function recordDeliveryAttempt(
  payload: AlertPayload,
  result: DeliveryResult,
): Promise<void> {
  const outcome = classifyOutcome(result);
  const channelStats = payload.stats[payload.queueChannel];
  await logAuditEvent({
    actionType: QUEUE_FALLBACK_ALERT_ACTION_TYPE,
    entityType: QUEUE_FALLBACK_ALERT_ENTITY_TYPE,
    entityId: payload.queueChannel,
    description: describeAttempt(payload, result, outcome),
    metadata: {
      queueChannel: payload.queueChannel,
      deliveryChannel: result.channel,
      kind: payload.kind,
      outcome,
      reason: result.reason ?? null,
      recentCount: channelStats.recentCount,
      hourCount: channelStats.hourCount,
      dayCount: channelStats.dayCount,
      lastAt: channelStats.lastAt,
      recentWindowMs: payload.stats.recentWindowMs,
    },
  });
}

async function dispatchAll(payload: AlertPayload): Promise<DeliveryResult[]> {
  const throttleMs = getNotificationThrottleMs();
  const promises: Promise<DeliveryResult>[] = (
    ["pagerduty", "email", "slack"] as const
  ).map(async (dc) => {
    // Claim the per-(queue,delivery,kind) throttle slot atomically before we
    // attempt to send, so two pods racing on the same transition don't both
    // page on-call. The slot is shared via Redis (in-memory fallback when no
    // Redis is configured), so the throttle cap holds across the whole
    // cluster — not per pod.
    const claimed = await tryClaimThrottleSlot(
      payload.queueChannel,
      dc,
      payload.kind,
      throttleMs,
      payload.now,
    );
    if (!claimed) {
      return { channel: dc, ok: true, skipped: true, reason: "throttled" };
    }
    const fn = deliveryOverrides?.[dc] ?? defaultDeliveries[dc];
    try {
      const result = await fn(payload);
      // If the provider was simply not configured, free the slot so we don't
      // burn the whole throttle window on a no-op (matching prior behavior).
      // If the send itself failed, also free the slot so the next attempt
      // can immediately retry instead of waiting out the throttle.
      if (!result.ok || result.skipped) {
        await releaseThrottleSlot(payload.queueChannel, dc, payload.kind);
      }
      return result;
    } catch (err) {
      // Free the slot on unexpected errors too — same reasoning as above.
      await releaseThrottleSlot(payload.queueChannel, dc, payload.kind);
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[QueueFallbackAlerter] ${dc} ${payload.kind} for ${payload.queueChannel} failed:`,
        err,
      );
      return { channel: dc, ok: false, reason };
    }
  });
  const results = await Promise.all(promises);

  // Record one audit row per delivery attempt (including throttled/skipped
  // ones) so admins can later see why no page went out. We await all of
  // them so callers / tests observing dispatch completion also see the
  // audit rows; logAuditEvent swallows DB errors internally so this can't
  // throw on us.
  await Promise.all(results.map((r) => recordDeliveryAttempt(payload, r)));

  return results;
}

/**
 * Read the current fallback stats and dispatch any state-transition alerts
 * (fire on first event in the recent window, clear when the window empties).
 * Safe to call frequently; transitions are gated by per-channel state and
 * deliveries are throttled.
 *
 * The "currently alerting" decision uses DB-backed stats so all api-server
 * instances agree on the same view, and the alerting-flag flip is a
 * cluster-shared compare-and-set so a given transition is observed by
 * exactly one pod.
 */
export async function evaluateQueueFallbackAlerts(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const stats = await getQueueFallbackStatsFromDb();
  const all: DeliveryResult[] = [];
  for (const ch of ["email", "sms"] as const) {
    const currently = stats[ch].recentCount > 0;
    const transitioned = await compareAndSetAlertingState(ch, currently);
    if (!transitioned) continue;
    const kind: AlertKind = currently ? "fire" : "clear";
    const results = await dispatchAll({ queueChannel: ch, kind, stats, now });
    all.push(...results);
  }
  return all;
}

let pollHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Wire the alerter into the tracker (so "fire" alerts dispatch within ms of
 * the first fallback) and start the recovery poll. Idempotent.
 */
export function startQueueFallbackAlerter(): void {
  if (started) return;
  started = true;
  setQueueFallbackListener(() => {
    evaluateQueueFallbackAlerts().catch((err) => {
      console.error("[QueueFallbackAlerter] dispatch error:", err);
    });
  });
  if (POLL_MS > 0) {
    pollHandle = setInterval(() => {
      evaluateQueueFallbackAlerts().catch((err) => {
        console.error("[QueueFallbackAlerter] poll error:", err);
      });
    }, POLL_MS);
    pollHandle.unref?.();
  }
}

/**
 * Fire a synthetic fire+clear pair through every delivery channel using the
 * current saved destinations. Bypasses the per-channel alerting state and the
 * notification throttle so admins can verify routing on demand from the
 * Settings UI. Each delivery still reports `skipped: true` when a destination
 * isn't configured, so the UI can show which channels were actually exercised.
 */
export async function sendOnCallTestAlert(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const stats = getQueueFallbackStats();
  const results: DeliveryResult[] = [];
  for (const kind of ["fire", "clear"] as const) {
    const payload: AlertPayload = {
      queueChannel: "email",
      kind,
      stats,
      now,
      isTest: true,
    };
    const promises: Promise<DeliveryResult>[] = (
      ["pagerduty", "email", "slack"] as const
    ).map(async (dc) => {
      const fn = deliveryOverrides?.[dc] ?? defaultDeliveries[dc];
      try {
        return await fn(payload);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(
          `[QueueFallbackAlerter] test ${kind} on ${dc} failed:`,
          err,
        );
        return { channel: dc, ok: false, reason };
      }
    });
    results.push(...(await Promise.all(promises)));
  }
  return results;
}

/** Stop the poll and detach from the tracker. */
export function stopQueueFallbackAlerter(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  setQueueFallbackListener(null);
  started = false;
}
