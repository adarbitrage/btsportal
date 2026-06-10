/**
 * Actively detects when the TicketDesk chat widget script becomes unavailable,
 * which would silently break the live-chat widget for all portal members.
 *
 * Why this exists: `LiveChatLauncher.tsx` injects the TicketDesk `widget.js`
 * script into the portal page. If the widget script URL ever stops responding
 * (404, 403, server error, DNS failure), the TicketDesk widget silently fails
 * to initialise and members get no live-chat launcher at all. This probe
 * periodically fetches the widget script URL, checks it responds with a 2xx
 * status, and pages on-call (and surfaces on System Health) the moment the
 * script becomes unreachable — before anyone reports it.
 *
 * Resilience: a single transient failure (TicketDesk briefly down, DNS blip,
 * timeout, 5xx server error) is classified as `unreachable` and is
 * *inconclusive* — it never increments the blocked streak and never clears an
 * active alert. Only a definitively non-loadable response (4xx) increments the
 * blocked streak; we only page after `threshold` consecutive blocked probes
 * (default 3), so transient blips can't false-alarm.
 *
 * Delivery, throttling, and SendGrid lazy init are owned by the shared
 * `oncall-dispatcher.ts`. Delivery channels use the same env vars as every
 * other alerter:
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY
 *   - Ops email:  OPS_ALERT_EMAIL  (sent via SendGrid; SENDGRID_API_KEY required)
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL
 *
 * Tunables (env, all optional):
 *   - LIVE_CHAT_EMBED_PROBE_URL                (default: widget.js URL from support-config)
 *   - LIVE_CHAT_EMBED_PROBE_POLL_MS            (default 5 min)
 *   - LIVE_CHAT_EMBED_PROBE_TIMEOUT_MS         (default 8s)
 *   - LIVE_CHAT_EMBED_BLOCKED_THRESHOLD        (default 3 consecutive unavailable probes)
 *   - LIVE_CHAT_EMBED_ALERT_THROTTLE_MS        (default 15 min per channel)
 */

import {
  DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL,
} from "@workspace/support-config";

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
  type OnCallDestinations,
} from "./oncall-dispatcher";

export type { DeliveryResult };

// Default falls back to the shared widget script URL so the URL this probe
// checks and the URL the portal actually loads can never silently diverge.
const DEFAULT_PROBE_URL = DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL;

export function getLiveChatEmbedProbeUrl(): string {
  const raw = process.env.LIVE_CHAT_EMBED_PROBE_URL;
  return raw && raw.trim().length > 0 ? raw.trim() : DEFAULT_PROBE_URL;
}

function getPollMs(): number {
  return parseEnvInt("LIVE_CHAT_EMBED_PROBE_POLL_MS", 5 * 60 * 1000);
}

function getTimeoutMs(): number {
  return parseEnvInt("LIVE_CHAT_EMBED_PROBE_TIMEOUT_MS", 8_000);
}

export function getBlockedThreshold(): number {
  const raw = parseEnvInt("LIVE_CHAT_EMBED_BLOCKED_THRESHOLD", 3);
  return raw > 0 ? raw : 3;
}

function getThrottleMs(): number {
  return parseEnvInt("LIVE_CHAT_EMBED_ALERT_THROTTLE_MS", 15 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Probe execution
// ---------------------------------------------------------------------------

export type ProbeStatus = "ok" | "blocked" | "unreachable";

export interface ProbeOutcome {
  status: ProbeStatus;
  reasons: string[];
  /** Short error description for an `unreachable` probe, else null. */
  error: string | null;
  /** Final HTTP status when a response arrived, else null. */
  httpStatus: number | null;
}

let fetchOverride: typeof fetch | null = null;

/** Test-only: replace the network fetch used by the probe. */
export function __setLiveChatEmbedProbeFetchForTests(
  fn: typeof fetch | null,
): void {
  fetchOverride = fn;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/**
 * Run a single probe of the widget script URL. Follows redirects.
 *
 * Status semantics:
 *   - `ok`          — script responded 2xx; the widget will load.
 *   - `blocked`     — script responded 4xx (not found, forbidden, etc.);
 *                     the widget will fail to load for all members.
 *   - `unreachable` — network error, timeout, or 5xx server error; the
 *                     result is inconclusive (may be transient).
 *
 * Only `blocked` increments the alerting streak; `unreachable` is held
 * inconclusive so a brief server restart can't false-alarm.
 */
export async function performLiveChatEmbedProbe(): Promise<ProbeOutcome> {
  const url = getLiveChatEmbedProbeUrl();
  const doFetch = fetchOverride ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const res = await doFetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "BTS-LiveChatEmbedProbe/1.0" },
    });
    if (res.status >= 500) {
      // 5xx — server error, likely transient; hold as inconclusive.
      return {
        status: "unreachable",
        reasons: [],
        error: `http_${res.status}`,
        httpStatus: res.status,
      };
    }
    if (res.status >= 400) {
      // 4xx — script definitively not loadable (wrong URL, access denied, etc.).
      return {
        status: "blocked",
        reasons: [`http_${res.status}`],
        error: null,
        httpStatus: res.status,
      };
    }
    return { status: "ok", reasons: [], error: null, httpStatus: res.status };
  } catch (err) {
    return {
      status: "unreachable",
      reasons: [],
      error: describeError(err),
      httpStatus: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// State machine + alerting
// ---------------------------------------------------------------------------

export interface LiveChatEmbedAlertPayload {
  kind: AlertKind;
  now: number;
  url: string;
  threshold: number;
  consecutiveBlocked: number;
  reasons: string[];
  lastBlockedAt: string | null;
}

interface ProbeState {
  lastStatus: ProbeStatus | "unknown";
  lastCheckedAt: number | null;
  lastOkAt: number | null;
  lastBlockedAt: number | null;
  lastUnreachableAt: number | null;
  consecutiveBlocked: number;
  consecutiveUnreachable: number;
  reasons: string[];
  lastError: string | null;
  alerting: boolean;
}

const probeState: ProbeState = {
  lastStatus: "unknown",
  lastCheckedAt: null,
  lastOkAt: null,
  lastBlockedAt: null,
  lastUnreachableAt: null,
  consecutiveBlocked: 0,
  consecutiveUnreachable: 0,
  reasons: [],
  lastError: null,
  alerting: false,
};

function destinationsFromEnv(): OnCallDestinations {
  return {
    pagerdutyIntegrationKey: process.env.PAGERDUTY_INTEGRATION_KEY ?? null,
    opsAlertEmail: process.env.OPS_ALERT_EMAIL ?? null,
    opsAlertSlackWebhookUrl: process.env.OPS_ALERT_SLACK_WEBHOOK_URL ?? null,
  };
}

function buildMessages(p: LiveChatEmbedAlertPayload): AlertMessages {
  const reasonText =
    p.reasons.length > 0 ? p.reasons.join("; ") : "unavailable";
  const summary =
    p.kind === "fire"
      ? `Live Chat widget script unavailable — ${p.url} is not loading (${reasonText})`
      : `Live Chat widget script recovered — ${p.url} is accessible again`;
  const emailText =
    p.kind === "fire"
      ? [
          `The portal injects the TicketDesk chat widget script (${p.url}) to render`,
          `the live-chat launcher, but that script has returned a non-2xx response for`,
          `${p.consecutiveBlocked} consecutive probe(s) (threshold ${p.threshold}).`,
          "",
          `Last probe response: ${reasonText}.`,
          "",
          "Members currently get no live-chat widget at all. Check whether the",
          "TicketDesk widget script URL has changed or the service is down, and",
          "update LIVE_CHAT_EMBED_PROBE_URL / the shared support-config if needed.",
          "",
          `First detected unavailable at: ${p.lastBlockedAt ?? "n/a"}.`,
          "Confirm via /admin/system (Live Chat widget card).",
        ].join("\n")
      : [
          `The Live Chat widget script (${p.url}) is loading again — a recent probe`,
          "received a 2xx response. Marking the alert resolved.",
          "",
          "Confirm via /admin/system.",
        ].join("\n");
  const slackText =
    p.kind === "fire"
      ? `:rotating_light: *Live Chat widget script unavailable* — ${p.url} returned ${reasonText} ${p.consecutiveBlocked}× in a row (threshold ${p.threshold}). Members have no live-chat widget. Check /admin/system.`
      : `:white_check_mark: *Live Chat widget script recovered* — ${p.url} is accessible again.`;
  return {
    pagerduty: {
      dedupKey: "live-chat-embed:blocked",
      summary,
      severity: "error",
      component: "live-chat-embed",
      class: "live_chat_widget_unavailable",
      custom_details: {
        url: p.url,
        threshold: p.threshold,
        consecutiveBlocked: p.consecutiveBlocked,
        reasons: p.reasons,
        lastBlockedAt: p.lastBlockedAt,
        link: "/admin/system",
      },
    },
    email: {
      subject:
        p.kind === "fire"
          ? "[ALERT] Live Chat widget script is unavailable"
          : "[RESOLVED] Live Chat widget script recovered",
      text: emailText,
    },
    slack: { text: slackText },
  };
}

const throttleStore = createInMemoryThrottleStore();

const dispatcher = createOnCallDispatcher<LiveChatEmbedAlertPayload, string>({
  name: "LiveChatEmbedProbe",
  destinations: destinationsFromEnv,
  throttleMs: getThrottleMs,
  throttleStore,
  throttleKey: (p, dc) => `${p.kind}:${dc}`,
  buildMessages,
  kindOf: (p) => p.kind,
});

/** Test-only: replace one or more delivery functions with stubs. */
export function __setLiveChatEmbedProbeDeliveriesForTests(
  overrides: Partial<
    Record<DeliveryChannel, DeliveryFn<LiveChatEmbedAlertPayload>>
  > | null,
): void {
  dispatcher.setDeliveryOverrides(overrides);
}

/** Test-only: reset all probe state, throttle slots, and overrides. */
export function __resetLiveChatEmbedProbeForTests(): void {
  probeState.lastStatus = "unknown";
  probeState.lastCheckedAt = null;
  probeState.lastOkAt = null;
  probeState.lastBlockedAt = null;
  probeState.lastUnreachableAt = null;
  probeState.consecutiveBlocked = 0;
  probeState.consecutiveUnreachable = 0;
  probeState.reasons = [];
  probeState.lastError = null;
  probeState.alerting = false;
  throttleStore.reset();
  dispatcher.setDeliveryOverrides(null);
  fetchOverride = null;
}

function iso(ms: number | null): string | null {
  return ms !== null ? new Date(ms).toISOString() : null;
}

/**
 * Run one probe, fold the result into the rolling state machine, and
 * dispatch any state-transition alert.
 *
 *   - `ok`          → reset the blocked streak; if we were alerting, clear.
 *   - `unreachable` → inconclusive: bump the unreachable counter only. The
 *                     blocked streak and alerting state are left untouched so
 *                     a transient outage neither false-alarms nor resolves a
 *                     real block.
 *   - `blocked`     → bump the blocked streak; fire once it reaches threshold.
 */
export async function evaluateLiveChatEmbedProbe(
  now: number = Date.now(),
): Promise<{ outcome: ProbeOutcome; deliveries: DeliveryResult[] }> {
  const outcome = await performLiveChatEmbedProbe();
  probeState.lastCheckedAt = now;
  probeState.lastStatus = outcome.status;
  const threshold = getBlockedThreshold();
  const url = getLiveChatEmbedProbeUrl();

  if (outcome.status === "ok") {
    probeState.lastOkAt = now;
    probeState.consecutiveBlocked = 0;
    probeState.consecutiveUnreachable = 0;
    probeState.reasons = [];
    probeState.lastError = null;
    if (probeState.alerting) {
      probeState.alerting = false;
      const deliveries = await dispatcher.dispatch(
        {
          kind: "clear",
          now,
          url,
          threshold,
          consecutiveBlocked: 0,
          reasons: [],
          lastBlockedAt: iso(probeState.lastBlockedAt),
        },
        now,
      );
      return { outcome, deliveries };
    }
    return { outcome, deliveries: [] };
  }

  if (outcome.status === "unreachable") {
    probeState.consecutiveUnreachable += 1;
    probeState.lastUnreachableAt = now;
    probeState.lastError = outcome.error;
    return { outcome, deliveries: [] };
  }

  // blocked
  probeState.consecutiveBlocked += 1;
  probeState.consecutiveUnreachable = 0;
  probeState.lastBlockedAt = now;
  probeState.reasons = outcome.reasons;
  probeState.lastError = null;

  if (probeState.consecutiveBlocked >= threshold) {
    probeState.alerting = true;
    const deliveries = await dispatcher.dispatch(
      {
        kind: "fire",
        now,
        url,
        threshold,
        consecutiveBlocked: probeState.consecutiveBlocked,
        reasons: outcome.reasons,
        lastBlockedAt: iso(probeState.lastBlockedAt),
      },
      now,
    );
    return { outcome, deliveries };
  }

  return { outcome, deliveries: [] };
}

export interface LiveChatEmbedProbeStateView {
  url: string;
  status: ProbeStatus | "unknown";
  alerting: boolean;
  threshold: number;
  consecutiveBlocked: number;
  consecutiveUnreachable: number;
  reasons: string[];
  lastCheckedAt: string | null;
  lastOkAt: string | null;
  lastBlockedAt: string | null;
  lastUnreachableAt: string | null;
  lastError: string | null;
}

/**
 * Read-only snapshot for the admin System Health page. Lets the page render
 * the widget's status without re-deriving the transition logic.
 */
export function getLiveChatEmbedProbeState(): LiveChatEmbedProbeStateView {
  return {
    url: getLiveChatEmbedProbeUrl(),
    status: probeState.lastStatus,
    alerting: probeState.alerting,
    threshold: getBlockedThreshold(),
    consecutiveBlocked: probeState.consecutiveBlocked,
    consecutiveUnreachable: probeState.consecutiveUnreachable,
    reasons: [...probeState.reasons],
    lastCheckedAt: iso(probeState.lastCheckedAt),
    lastOkAt: iso(probeState.lastOkAt),
    lastBlockedAt: iso(probeState.lastBlockedAt),
    lastUnreachableAt: iso(probeState.lastUnreachableAt),
    lastError: probeState.lastError,
  };
}

const runner = createPollRunner({
  name: "LiveChatEmbedProbe",
  pollMs: getPollMs(),
  evaluate: () => evaluateLiveChatEmbedProbe(),
  startupEvaluate: true,
});

/** Start the widget script probe poll. Idempotent. */
export function startLiveChatEmbedProbe(): void {
  runner.start();
}

/** Stop the widget script probe poll. */
export function stopLiveChatEmbedProbe(): void {
  runner.stop();
}
