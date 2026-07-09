/**
 * Shared on-call dispatcher used by every "page on-call when X happens"
 * alerter (queue-fallback, signup-challenge, production-env-guard).
 *
 * Each alerter used to re-implement PagerDuty / SendGrid / Slack delivery,
 * the per-channel throttle, the SendGrid lazy init, and the test hooks. A
 * bug fix or channel-config change had to be made in three places, and the
 * next "alert when X" feature would tempt a fourth copy.
 *
 * This module owns the delivery plumbing once. Each alerter becomes a thin
 * adapter that supplies:
 *
 *   - its own state-transition detector (e.g. "Redis says queue is in
 *     fallback now, last poll said it wasn't"),
 *   - per-alert title / message / dedup key (`buildMessages`),
 *   - and the appropriate throttle store (in-memory for single-instance
 *     alerters, Redis-backed for the cluster-shared queue-fallback alerter).
 *
 * Adding a fourth alerter is a small file that only describes what to detect
 * and what to say — not a copy of ~300 lines of delivery plumbing.
 *
 * Delivery channels:
 *   - PagerDuty  — Events API v2 routing key (`pagerdutyIntegrationKey`)
 *   - Ops email  — recipient (`opsAlertEmail`) sent via SendGrid
 *                  (from address falls back to `OPS_ALERT_FROM_EMAIL` ->
 *                  `FROM_EMAIL` -> `noreply@buildtestscale.com`)
 *   - Slack      — incoming webhook URL (`opsAlertSlackWebhookUrl`)
 *
 * Each destination is read fresh at dispatch time via the supplied
 * `destinations` callback so admin edits (queue-fallback) or env var changes
 * (signup-challenge / production-env-guard) take effect without restarting.
 *
 * Throttling is "pre-claim then release on no-op" so two pods racing on the
 * same transition can't both page on-call: whichever wins the throttle slot
 * sends, the loser reports `{ skipped: true, reason: "throttled" }`. If the
 * delivery itself fails or no-ops (provider not configured) we release the
 * slot immediately so the next attempt can retry without waiting out the
 * whole throttle window.
 */

import sgMail from "@sendgrid/mail";
import { gatedSendEmail } from "./email-transport";

export type DeliveryChannel = "pagerduty" | "email" | "slack";
export type AlertKind = "fire" | "clear";

/**
 * Resolved on-call destinations as seen at dispatch time. Each field is
 * nullable — a `null` value means "not configured", which the dispatcher
 * surfaces as `{ skipped: true, reason: "not_configured" }`.
 */
export interface OnCallDestinations {
  pagerdutyIntegrationKey: string | null;
  opsAlertEmail: string | null;
  opsAlertSlackWebhookUrl: string | null;
}

/**
 * The fields the dispatcher needs to build a PagerDuty Events API v2
 * payload. `severity` defaults to `"error"` and `source` to `HOSTNAME` /
 * `"api-server"`. The `class`, `group`, `component`, and `custom_details`
 * fields are optional — omit them when not relevant.
 */
export interface PagerDutyMessage {
  dedupKey: string;
  summary: string;
  severity?: "info" | "warning" | "error" | "critical";
  source?: string;
  component?: string;
  group?: string;
  class?: string;
  custom_details?: Record<string, unknown>;
}

export interface EmailMessage {
  subject: string;
  text: string;
}

export interface SlackMessage {
  text: string;
}

export interface AlertMessages {
  pagerduty: PagerDutyMessage;
  email: EmailMessage;
  slack: SlackMessage;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  ok: boolean;
  /** True if no notification was attempted (e.g. provider not configured or throttled). */
  skipped?: boolean;
  reason?: string;
}

export type DeliveryFn<TPayload> = (
  payload: TPayload,
) => Promise<DeliveryResult>;

/**
 * Throttle slot store. Two implementations are bundled:
 *   - `createInMemoryThrottleStore()` for single-instance alerters
 *     (signup-challenge, production-env-guard).
 *   - `queue-fallback-alerter-state.ts` provides the cluster-shared
 *     Redis-backed implementation used by the queue-fallback alerter so the
 *     "one page per N minutes" cap holds across the whole cluster, not
 *     per pod.
 */
export interface ThrottleStore<TKey> {
  /** Returns true if the slot was claimed (caller should attempt to send). */
  tryClaim: (key: TKey, throttleMs: number, now: number) => Promise<boolean>;
  /** Release a claimed slot, e.g. after the send was a no-op or failed. */
  release: (key: TKey) => Promise<void>;
}

export interface InMemoryThrottleStore extends ThrottleStore<string> {
  reset: () => void;
}

export function createInMemoryThrottleStore(): InMemoryThrottleStore {
  const slots = new Map<string, number>();
  return {
    async tryClaim(key, throttleMs, now) {
      if (throttleMs <= 0) return true;
      const expiry = slots.get(key);
      if (expiry !== undefined && expiry > now) return false;
      slots.set(key, now + throttleMs);
      return true;
    },
    async release(key) {
      slots.delete(key);
    },
    reset() {
      slots.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// SendGrid lazy init — shared across every alerter (and the queue-fallback
// destination probes) so we don't re-call `sgMail.setApiKey` per module.
// ---------------------------------------------------------------------------

let sgMailInitialized = false;

/** Returns true when SendGrid is ready to send (i.e. API key is configured). */
export function ensureSendGridInitialized(): boolean {
  if (sgMailInitialized) return true;
  if (!process.env.SENDGRID_API_KEY) return false;
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  sgMailInitialized = true;
  return true;
}

/** Test-only: drop the cached init flag so the next ensure call re-runs. */
export function __resetSendGridInitForTests(): void {
  sgMailInitialized = false;
}

/** The "From" address used for every ops alert email. */
export function defaultOpsAlertFromEmail(): string {
  return (
    process.env.OPS_ALERT_FROM_EMAIL ??
    process.env.FROM_EMAIL ??
    "noreply@buildtestscale.com"
  );
}

/**
 * Parse a non-negative integer environment variable, falling back to the
 * supplied default when unset or unparseable. Shared by every alerter for
 * its throttle / poll cadence configuration so the parsing rules stay
 * identical.
 */
export function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// Dispatcher factory
// ---------------------------------------------------------------------------

export interface DispatcherOptions<TPayload, TKey> {
  /** Used in error logs. */
  name: string;
  /** Resolves the current destinations at dispatch time. */
  destinations: () => Promise<OnCallDestinations> | OnCallDestinations;
  /**
   * Throttle window in ms (re-read per dispatch so env-driven or
   * admin-edited overrides take effect). May be async so the value can be
   * sourced from the DB at dispatch time.
   */
  throttleMs: () => number | Promise<number>;
  /** Where to claim/release throttle slots. */
  throttleStore: ThrottleStore<TKey>;
  /** Build the throttle key for a given (payload, channel). */
  throttleKey: (payload: TPayload, channel: DeliveryChannel) => TKey;
  /** Build the per-channel message bodies for a payload. */
  buildMessages: (payload: TPayload) => AlertMessages;
  /** Identifies fire vs clear so the dispatcher can produce the right PD body. */
  kindOf: (payload: TPayload) => AlertKind;
  /** Optional hook fired for every result (used by queue-fallback for audit logging). */
  onDelivery?: (payload: TPayload, result: DeliveryResult) => Promise<void>;
}

export interface Dispatcher<TPayload> {
  /** Dispatch with throttling + onDelivery hook. */
  dispatch: (payload: TPayload, now: number) => Promise<DeliveryResult[]>;
  /** Dispatch without throttling and without firing onDelivery — used for the
   *  synthetic "test routing" alert from the admin Settings page. */
  dispatchUnthrottled: (payload: TPayload) => Promise<DeliveryResult[]>;
  /** Test-only: replace one or more delivery functions with stubs. */
  setDeliveryOverrides: (
    overrides: Partial<Record<DeliveryChannel, DeliveryFn<TPayload>>> | null,
  ) => void;
}

/**
 * Build a dispatcher with default PagerDuty / SendGrid / Slack delivery
 * functions and the supplied throttle + message-building strategy.
 */
export function createOnCallDispatcher<TPayload, TKey>(
  opts: DispatcherOptions<TPayload, TKey>,
): Dispatcher<TPayload> {
  let overrides:
    | Partial<Record<DeliveryChannel, DeliveryFn<TPayload>>>
    | null = null;

  const defaults: Record<DeliveryChannel, DeliveryFn<TPayload>> = {
    pagerduty: async (payload) => {
      const dest = await opts.destinations();
      const key = dest.pagerdutyIntegrationKey;
      if (!key) {
        return {
          channel: "pagerduty",
          ok: true,
          skipped: true,
          reason: "not_configured",
        };
      }
      const msg = opts.buildMessages(payload).pagerduty;
      const kind = opts.kindOf(payload);
      const body =
        kind === "fire"
          ? {
              routing_key: key,
              event_action: "trigger" as const,
              dedup_key: msg.dedupKey,
              payload: {
                summary: msg.summary,
                severity: msg.severity ?? "error",
                source: msg.source ?? process.env.HOSTNAME ?? "api-server",
                ...(msg.component ? { component: msg.component } : {}),
                ...(msg.group ? { group: msg.group } : {}),
                ...(msg.class ? { class: msg.class } : {}),
                ...(msg.custom_details
                  ? { custom_details: msg.custom_details }
                  : {}),
              },
            }
          : {
              routing_key: key,
              event_action: "resolve" as const,
              dedup_key: msg.dedupKey,
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

    email: async (payload) => {
      const dest = await opts.destinations();
      const to = dest.opsAlertEmail;
      if (!to) {
        return {
          channel: "email",
          ok: true,
          skipped: true,
          reason: "not_configured",
        };
      }
      if (!ensureSendGridInitialized()) {
        return {
          channel: "email",
          ok: true,
          skipped: true,
          reason: "sendgrid_not_configured",
        };
      }
      const msg = opts.buildMessages(payload).email;
      await gatedSendEmail({
        to,
        from: defaultOpsAlertFromEmail(),
        subject: msg.subject,
        text: msg.text,
      });
      return { channel: "email", ok: true };
    },

    slack: async (payload) => {
      const dest = await opts.destinations();
      const url = dest.opsAlertSlackWebhookUrl;
      if (!url) {
        return {
          channel: "slack",
          ok: true,
          skipped: true,
          reason: "not_configured",
        };
      }
      const msg = opts.buildMessages(payload).slack;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg.text }),
      });
      if (!res.ok) {
        return { channel: "slack", ok: false, reason: `http_${res.status}` };
      }
      return { channel: "slack", ok: true };
    },
  };

  function deliveryFor(channel: DeliveryChannel): DeliveryFn<TPayload> {
    return overrides?.[channel] ?? defaults[channel];
  }

  async function dispatch(
    payload: TPayload,
    now: number,
  ): Promise<DeliveryResult[]> {
    const throttleMs = await opts.throttleMs();
    const channels: readonly DeliveryChannel[] = [
      "pagerduty",
      "email",
      "slack",
    ];
    const results = await Promise.all(
      channels.map(async (dc): Promise<DeliveryResult> => {
        const tkey = opts.throttleKey(payload, dc);
        const claimed = await opts.throttleStore.tryClaim(
          tkey,
          throttleMs,
          now,
        );
        if (!claimed) {
          return {
            channel: dc,
            ok: true,
            skipped: true,
            reason: "throttled",
          };
        }
        try {
          const result = await deliveryFor(dc)(payload);
          // Free the slot when the send was a no-op (provider not configured)
          // or failed, so the next attempt can immediately retry instead of
          // waiting out the full throttle window.
          if (!result.ok || result.skipped) {
            await opts.throttleStore.release(tkey);
          }
          return result;
        } catch (err) {
          await opts.throttleStore.release(tkey);
          const reason = err instanceof Error ? err.message : String(err);
          const kind = opts.kindOf(payload);
          console.error(`[${opts.name}] ${dc} ${kind} failed:`, err);
          return { channel: dc, ok: false, reason };
        }
      }),
    );

    if (opts.onDelivery) {
      const hook = opts.onDelivery;
      await Promise.all(results.map((r) => hook(payload, r)));
    }

    return results;
  }

  async function dispatchUnthrottled(
    payload: TPayload,
  ): Promise<DeliveryResult[]> {
    const channels: readonly DeliveryChannel[] = [
      "pagerduty",
      "email",
      "slack",
    ];
    return Promise.all(
      channels.map(async (dc): Promise<DeliveryResult> => {
        try {
          return await deliveryFor(dc)(payload);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          const kind = opts.kindOf(payload);
          console.error(`[${opts.name}] test ${kind} on ${dc} failed:`, err);
          return { channel: dc, ok: false, reason };
        }
      }),
    );
  }

  return {
    dispatch,
    dispatchUnthrottled,
    setDeliveryOverrides(o) {
      overrides = o;
    },
  };
}

// ---------------------------------------------------------------------------
// Common poll-loop runner
// ---------------------------------------------------------------------------

export interface AlerterRunner {
  start: () => void;
  stop: () => void;
}

/**
 * Boilerplate-free start/stop wrapper for a polling alerter. `evaluate` is
 * invoked once on `start()` (so a misconfiguration is detected even if no
 * admin loads the dashboard), and then on the supplied `pollMs` cadence.
 *
 * Errors thrown by `evaluate` are caught and logged so a transient DB blip
 * never crashes the alerter loop.
 */
export function createPollRunner(opts: {
  name: string;
  pollMs: number;
  evaluate: () => Promise<unknown>;
  /** Optional one-time setup (e.g. wiring a tracker listener). */
  onStart?: () => void;
  /** When true, run an immediate `evaluate()` in `start()` (default false). */
  startupEvaluate?: boolean;
}): AlerterRunner {
  let pollHandle: ReturnType<typeof setInterval> | null = null;
  let started = false;
  return {
    start() {
      if (started) return;
      started = true;
      opts.onStart?.();
      if (opts.startupEvaluate) {
        opts.evaluate().catch((err) => {
          console.error(`[${opts.name}] startup error:`, err);
        });
      }
      if (opts.pollMs > 0) {
        pollHandle = setInterval(() => {
          opts.evaluate().catch((err) => {
            console.error(`[${opts.name}] poll error:`, err);
          });
        }, opts.pollMs);
        pollHandle.unref?.();
      }
    },
    stop() {
      if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
      started = false;
    },
  };
}
