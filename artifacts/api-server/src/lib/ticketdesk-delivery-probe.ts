/**
 * Proactively detects when programmatic support-ticket delivery into TicketDesk
 * stops working because the portal domain was dropped from TicketDesk's
 * allowed-origins list (or the portal domain changed).
 *
 * Why this exists: portal support tickets are delivered to the TicketDesk agent
 * inbox by `createConversation` (ticketdesk-client.ts), which POSTs to
 * /api/chat/session with the portal's Origin header. TicketDesk validates that
 * Origin against the workspace's allowed-origins list. If the entry is ever
 * removed, every delivery silently starts failing with a 403 "Origin not
 * allowed" and the BullMQ worker retries forever — members' tickets quietly
 * pile up undelivered, and the only signal today is the per-ticket fallback
 * email after all retries are exhausted.
 *
 * The existing live-chat-embed probe only GETs widget.js; it never exercises
 * this origin gate. This probe periodically POSTs to the chat-session endpoint
 * with the configured Origin, treats a 403 "Origin not allowed" as the delivery
 * path being blocked, pages on-call, and surfaces on System Health — distinct
 * from the widget-embed probe.
 *
 * Resilience: a single transient failure (TicketDesk briefly down, DNS blip,
 * timeout, 5xx server error, non-origin 403) is classified `unreachable` and is
 * *inconclusive* — it never increments the blocked streak and never clears an
 * active alert. Only a definitive 403 "Origin not allowed" increments the
 * blocked streak; we only page after `threshold` consecutive blocked probes
 * (default 3), so transient blips can't false-alarm.
 *
 * Footprint: `probeDeliveryGate` uses a dedicated, clearly-labelled probe
 * contact whose chat session is get-or-create, so every run reuses ONE thread
 * rather than spawning a fresh one in the live agent inbox. The probe posts no
 * message, so that thread stays empty. After a successful probe we additionally
 * make a best-effort attempt to archive/close the probe thread so agents never
 * see it in their active queue — but the live TicketDesk exposes no REST
 * endpoint for this today, so the cleanup is a no-op until one is configured.
 * See `archiveDeliveryProbeThread` in ticketdesk-client.ts for the full,
 * verified rationale. Do NOT "fix" the probe contact by deleting it.
 *
 * Delivery, throttling, and SendGrid lazy init are owned by the shared
 * `oncall-dispatcher.ts`. Delivery channels use the same env vars as every
 * other alerter:
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY
 *   - Ops email:  OPS_ALERT_EMAIL  (sent via SendGrid; SENDGRID_API_KEY required)
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL
 *
 * Tunables (env, all optional):
 *   - TICKETDESK_DELIVERY_PROBE_ENABLED        (default: on only in production)
 *   - TICKETDESK_DELIVERY_PROBE_POLL_MS        (default 5 min)
 *   - TICKETDESK_DELIVERY_PROBE_TIMEOUT_MS     (default 8s)
 *   - TICKETDESK_DELIVERY_BLOCKED_THRESHOLD    (default 3 consecutive blocked probes)
 *   - TICKETDESK_DELIVERY_ALERT_THROTTLE_MS    (default 15 min per channel)
 */

import {
  probeDeliveryGate,
  archiveDeliveryProbeThread,
  getTicketDeskChatOrigin,
  type DeliveryGateStatus,
} from "./ticketdesk-client";

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

export type ProbeStatus = DeliveryGateStatus;

function getPollMs(): number {
  return parseEnvInt("TICKETDESK_DELIVERY_PROBE_POLL_MS", 5 * 60 * 1000);
}

function getTimeoutMs(): number {
  return parseEnvInt("TICKETDESK_DELIVERY_PROBE_TIMEOUT_MS", 8_000);
}

export function getBlockedThreshold(): number {
  const raw = parseEnvInt("TICKETDESK_DELIVERY_BLOCKED_THRESHOLD", 3);
  return raw > 0 ? raw : 3;
}

function getThrottleMs(): number {
  return parseEnvInt("TICKETDESK_DELIVERY_ALERT_THROTTLE_MS", 15 * 60 * 1000);
}

/**
 * Whether the live poll loop should run. The probe makes a real POST to the
 * live TicketDesk workspace, so by default it only runs in production; dev/test
 * boots don't touch the shared live inbox. Force on/off with
 * TICKETDESK_DELIVERY_PROBE_ENABLED=true|false. (This gates only the poll
 * runner — `evaluateTicketDeskDeliveryProbe` can still be driven directly,
 * e.g. by tests with a stubbed fetch.)
 */
function isProbeEnabled(): boolean {
  const raw = process.env.TICKETDESK_DELIVERY_PROBE_ENABLED;
  if (raw !== undefined && raw.trim().length > 0) {
    return raw.trim().toLowerCase() === "true" || raw.trim() === "1";
  }
  return process.env.NODE_ENV === "production";
}

// ---------------------------------------------------------------------------
// Probe execution
// ---------------------------------------------------------------------------

export interface ProbeOutcome {
  status: ProbeStatus;
  reasons: string[];
  /** Short error description for an `unreachable` probe, else null. */
  error: string | null;
  /** Final HTTP status when a response arrived, else null. */
  httpStatus: number | null;
  /** Session token from a successful (ok) session creation — used for the
   * best-effort probe-thread cleanup. Null otherwise. */
  sessionToken: string | null;
  /** Thread id from a successful (ok) session creation, else null. */
  threadId: string | null;
}

let fetchOverride: typeof fetch | null = null;

/** Test-only: replace the network fetch used by the probe. */
export function __setTicketDeskDeliveryProbeFetchForTests(
  fn: typeof fetch | null,
): void {
  fetchOverride = fn;
}

/**
 * Run a single probe of the chat-session origin gate.
 *
 * Status semantics:
 *   - `ok`          — origin accepted; programmatic delivery would succeed.
 *   - `blocked`     — 403 "Origin not allowed"; delivery is broken for everyone.
 *   - `unreachable` — network error, timeout, 5xx, or a non-origin 403; the
 *                     result is inconclusive (may be transient).
 */
export async function performTicketDeskDeliveryProbe(): Promise<ProbeOutcome> {
  const result = await probeDeliveryGate({
    timeoutMs: getTimeoutMs(),
    fetchImpl: fetchOverride ?? undefined,
  });
  if (result.status === "blocked") {
    const code = result.httpStatus ? `http_${result.httpStatus}` : "blocked";
    const reason = result.reason ? `${code}: ${result.reason}` : code;
    return {
      status: "blocked",
      reasons: [reason],
      error: null,
      httpStatus: result.httpStatus,
      sessionToken: null,
      threadId: null,
    };
  }
  if (result.status === "unreachable") {
    return {
      status: "unreachable",
      reasons: [],
      error: result.error,
      httpStatus: result.httpStatus,
      sessionToken: null,
      threadId: null,
    };
  }
  return {
    status: "ok",
    reasons: [],
    error: null,
    httpStatus: result.httpStatus,
    sessionToken: result.sessionToken,
    threadId: result.threadId,
  };
}

/**
 * Best-effort cleanup of the dedicated probe thread after a successful probe.
 *
 * This is a no-op unless TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH points at a real
 * TicketDesk archive/close endpoint (none exists on the live instance today —
 * see `archiveDeliveryProbeThread` in ticketdesk-client.ts). It NEVER throws and
 * NEVER affects the probe's health verdict: any failure is swallowed here.
 */
async function cleanupProbeThread(outcome: ProbeOutcome): Promise<void> {
  if (outcome.status !== "ok" || !outcome.sessionToken) return;
  try {
    const result = await archiveDeliveryProbeThread({
      sessionToken: outcome.sessionToken,
      threadId: outcome.threadId,
      timeoutMs: getTimeoutMs(),
      fetchImpl: fetchOverride ?? undefined,
    });
    if (result.attempted && !result.ok) {
      console.warn(
        `[TicketDeskDeliveryProbe] probe-thread cleanup did not succeed (${result.error ?? "unknown"})`,
      );
    }
  } catch (err) {
    // Defensive: archiveDeliveryProbeThread already swallows errors, but never
    // let cleanup bubble into the probe verdict.
    console.warn(
      `[TicketDeskDeliveryProbe] probe-thread cleanup threw unexpectedly: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// State machine + alerting
// ---------------------------------------------------------------------------

export interface TicketDeskDeliveryAlertPayload {
  kind: AlertKind;
  now: number;
  origin: string;
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

function buildMessages(p: TicketDeskDeliveryAlertPayload): AlertMessages {
  const reasonText = p.reasons.length > 0 ? p.reasons.join("; ") : "blocked";
  const summary =
    p.kind === "fire"
      ? `Support ticket delivery BLOCKED — TicketDesk rejected origin ${p.origin} (${reasonText})`
      : `Support ticket delivery recovered — TicketDesk accepts origin ${p.origin} again`;
  const emailText =
    p.kind === "fire"
      ? [
          `Portal support tickets are no longer reaching the TicketDesk help desk.`,
          ``,
          `The chat-session delivery path (POST /api/chat/session) has been rejected`,
          `with a 403 "Origin not allowed" for ${p.consecutiveBlocked} consecutive`,
          `probe(s) (threshold ${p.threshold}). Origin sent: ${p.origin}.`,
          ``,
          `Last probe response: ${reasonText}.`,
          ``,
          `Every member ticket is now silently piling up undelivered and retrying`,
          `forever. Re-add the portal domain to the TicketDesk workspace's`,
          `allowed-origins list (Settings → Chat Config), or update`,
          `TICKETDESK_CHAT_ORIGIN if the portal domain changed.`,
          ``,
          `First detected blocked at: ${p.lastBlockedAt ?? "n/a"}.`,
          `Confirm via /admin/system (Ticket delivery gate card).`,
        ].join("\n")
      : [
          `TicketDesk is accepting origin ${p.origin} again — a recent probe`,
          `received a non-403 response, so programmatic ticket delivery works.`,
          `Marking the alert resolved.`,
          ``,
          `Confirm via /admin/system.`,
        ].join("\n");
  const slackText =
    p.kind === "fire"
      ? `:rotating_light: *Support ticket delivery BLOCKED* — TicketDesk rejected origin ${p.origin} (${reasonText}) ${p.consecutiveBlocked}× in a row (threshold ${p.threshold}). Member tickets are piling up undelivered. Re-add the portal domain to TicketDesk allowed-origins. Check /admin/system.`
      : `:white_check_mark: *Support ticket delivery recovered* — TicketDesk accepts origin ${p.origin} again.`;
  return {
    pagerduty: {
      dedupKey: "ticketdesk-delivery-gate:blocked",
      summary,
      severity: "critical",
      component: "ticketdesk-delivery-gate",
      class: "support_ticket_delivery_blocked",
      custom_details: {
        origin: p.origin,
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
          ? "[ALERT] Support tickets are not reaching TicketDesk (origin blocked)"
          : "[RESOLVED] Support ticket delivery recovered",
      text: emailText,
    },
    slack: { text: slackText },
  };
}

const throttleStore = createInMemoryThrottleStore();

const dispatcher = createOnCallDispatcher<TicketDeskDeliveryAlertPayload, string>({
  name: "TicketDeskDeliveryProbe",
  destinations: destinationsFromEnv,
  throttleMs: getThrottleMs,
  throttleStore,
  throttleKey: (p, dc) => `${p.kind}:${dc}`,
  buildMessages,
  kindOf: (p) => p.kind,
});

/** Test-only: replace one or more delivery functions with stubs. */
export function __setTicketDeskDeliveryProbeDeliveriesForTests(
  overrides: Partial<
    Record<DeliveryChannel, DeliveryFn<TicketDeskDeliveryAlertPayload>>
  > | null,
): void {
  dispatcher.setDeliveryOverrides(overrides);
}

/** Test-only: reset all probe state, throttle slots, and overrides. */
export function __resetTicketDeskDeliveryProbeForTests(): void {
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
 * Run one probe, fold the result into the rolling state machine, and dispatch
 * any state-transition alert.
 *
 *   - `ok`          → reset the blocked streak; if we were alerting, clear.
 *   - `unreachable` → inconclusive: bump the unreachable counter only. The
 *                     blocked streak and alerting state are left untouched.
 *   - `blocked`     → bump the blocked streak; fire once it reaches threshold.
 */
export async function evaluateTicketDeskDeliveryProbe(
  now: number = Date.now(),
): Promise<{ outcome: ProbeOutcome; deliveries: DeliveryResult[] }> {
  const outcome = await performTicketDeskDeliveryProbe();
  probeState.lastCheckedAt = now;
  probeState.lastStatus = outcome.status;
  const threshold = getBlockedThreshold();
  const origin = getTicketDeskChatOrigin();

  if (outcome.status === "ok") {
    probeState.lastOkAt = now;
    probeState.consecutiveBlocked = 0;
    probeState.consecutiveUnreachable = 0;
    probeState.reasons = [];
    probeState.lastError = null;
    // Best-effort: keep the dedicated probe thread out of the agent inbox.
    // No-op unless an archive endpoint is configured; never affects the verdict.
    await cleanupProbeThread(outcome);
    if (probeState.alerting) {
      probeState.alerting = false;
      const deliveries = await dispatcher.dispatch(
        {
          kind: "clear",
          now,
          origin,
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
        origin,
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

export interface TicketDeskDeliveryProbeStateView {
  origin: string;
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
 * Read-only snapshot for the admin System Health page. Lets the page render the
 * delivery-gate status without re-deriving the transition logic.
 */
export function getTicketDeskDeliveryProbeState(): TicketDeskDeliveryProbeStateView {
  return {
    origin: getTicketDeskChatOrigin(),
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
  name: "TicketDeskDeliveryProbe",
  pollMs: getPollMs(),
  evaluate: () => evaluateTicketDeskDeliveryProbe(),
  startupEvaluate: true,
});

/** Start the delivery-gate probe poll. No-op unless enabled. Idempotent. */
export function startTicketDeskDeliveryProbe(): void {
  if (!isProbeEnabled()) {
    console.log(
      "[TicketDeskDeliveryProbe] disabled (set TICKETDESK_DELIVERY_PROBE_ENABLED=true to force on outside production)",
    );
    return;
  }
  runner.start();
}

/** Stop the delivery-gate probe poll. */
export function stopTicketDeskDeliveryProbe(): void {
  runner.stop();
}
