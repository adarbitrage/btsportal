/**
 * Actively detects when the embedded Live Chat (TicketDesk) starts sending
 * framing-blocking response headers that would break the in-portal iframe
 * for real members.
 *
 * Why this exists: the portal embeds `https://tickets.buildtestscale.com/`
 * in an in-page iframe (`LiveChatLauncher.tsx`) and only falls back to a new
 * tab after an 8s client-side watchdog. If TicketDesk ever starts returning
 * `X-Frame-Options` or a CSP `frame-ancestors` directive that excludes the
 * portal's origin, the embed silently breaks and the only signal is a member
 * complaint. This probe periodically fetches the TicketDesk URL, inspects the
 * framing headers, and pages on-call (and surfaces on System Health) the
 * moment the embed would stop working — before anyone reports it.
 *
 * Resilience: a single transient failure (TicketDesk briefly down, DNS blip,
 * timeout) is classified as `unreachable` and is *inconclusive* — it never
 * increments the blocked streak and never clears an active alert. We only
 * page after the embed is observed blocked for `threshold` consecutive probes
 * (default 3), so a flaky moment can't false-alarm.
 *
 * Delivery, throttling, and SendGrid lazy init are owned by the shared
 * `oncall-dispatcher.ts`. Delivery channels use the same env vars as every
 * other alerter:
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY
 *   - Ops email:  OPS_ALERT_EMAIL  (sent via SendGrid; SENDGRID_API_KEY required)
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL
 *
 * Tunables (env, all optional):
 *   - LIVE_CHAT_EMBED_PROBE_URL                (default https://tickets.buildtestscale.com/)
 *   - LIVE_CHAT_EMBED_PROBE_POLL_MS            (default 5 min)
 *   - LIVE_CHAT_EMBED_PROBE_TIMEOUT_MS         (default 8s — matches the UI watchdog)
 *   - LIVE_CHAT_EMBED_BLOCKED_THRESHOLD        (default 3 consecutive blocked probes)
 *   - LIVE_CHAT_EMBED_ALERT_THROTTLE_MS        (default 15 min per channel)
 *   - PORTAL_URL                               (used to know which ancestor origin the
 *                                               embed needs; buildtestscale.com is always allowed)
 */

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

const DEFAULT_PROBE_URL = "https://tickets.buildtestscale.com/";

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
// Framing-header analysis (pure — unit tested directly)
// ---------------------------------------------------------------------------

export interface FramingAnalysis {
  /** True when the headers would prevent the portal from embedding the page. */
  blocked: boolean;
  /** Human-readable reasons, one per blocking header. */
  reasons: string[];
}

/** Minimal Headers-like shape so this is trivially testable. */
interface HeaderReader {
  get(name: string): string | null;
}

function hostFromUrlish(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    // Has a scheme — parse normally.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
      return new URL(v).hostname.toLowerCase();
    }
    // Bare host (optionally with port/path) — prefix a scheme to parse.
    return new URL(`https://${v}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Hosts whose origin is permitted to frame the embed. */
export function getAllowedAncestorHosts(): string[] {
  const hosts = new Set<string>(["buildtestscale.com"]);
  const portalHost = process.env.PORTAL_URL
    ? hostFromUrlish(process.env.PORTAL_URL)
    : null;
  if (portalHost) hosts.add(portalHost);
  return [...hosts];
}

/** True when `host` is `allowed` or a subdomain of it. */
function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

/**
 * Extract the `frame-ancestors` source list from a CSP header value, or
 * `null` when the directive is absent. Returns the lowercased tokens (e.g.
 * `["'none'"]`, `["'self'"]`, `["https://buildtestscale.com", "*"]`).
 */
export function extractFrameAncestors(csp: string): string[] | null {
  for (const directive of csp.split(";")) {
    const parts = directive.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    if (parts[0].toLowerCase() === "frame-ancestors") {
      return parts.slice(1).map((p) => p.toLowerCase());
    }
  }
  return null;
}

function frameAncestorsAllow(sources: string[], allowedHosts: string[]): boolean {
  if (sources.length === 0) return false; // empty == 'none'
  if (sources.includes("'none'")) return false;
  if (sources.includes("*")) return true;
  for (const src of sources) {
    if (src === "'self'") continue; // 'self' is TicketDesk's own origin, not the portal
    const wildcard = src.startsWith("*.");
    const bareHost = hostFromUrlish(wildcard ? src.slice(2) : src);
    if (!bareHost) continue;
    for (const allowed of allowedHosts) {
      if (wildcard) {
        // `*.example.com` allows any subdomain of example.com.
        if (allowed === bareHost || allowed.endsWith(`.${bareHost}`)) return true;
      } else if (hostMatches(allowed, bareHost) || hostMatches(bareHost, allowed)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Inspect framing headers and decide whether the portal (origin in
 * `allowedHosts`) would be blocked from embedding the response.
 */
export function analyzeFramingHeaders(
  headers: HeaderReader,
  allowedHosts: string[] = getAllowedAncestorHosts(),
): FramingAnalysis {
  const reasons: string[] = [];

  const xfo = headers.get("x-frame-options");
  if (xfo && xfo.trim().length > 0) {
    const v = xfo.trim().toLowerCase();
    // Every X-Frame-Options value blocks the portal: DENY blocks all frames;
    // SAMEORIGIN blocks because the portal is a different origin than
    // tickets.buildtestscale.com; the obsolete ALLOW-FROM is ignored by
    // modern browsers and treated as a block.
    if (v.includes("deny")) reasons.push("X-Frame-Options: DENY");
    else if (v.includes("sameorigin")) reasons.push("X-Frame-Options: SAMEORIGIN");
    else reasons.push(`X-Frame-Options: ${xfo.trim()}`);
  }

  const csp = headers.get("content-security-policy");
  if (csp && csp.trim().length > 0) {
    const fa = extractFrameAncestors(csp);
    if (fa !== null && !frameAncestorsAllow(fa, allowedHosts)) {
      const rendered = fa.length > 0 ? fa.join(" ") : "'none'";
      reasons.push(`CSP frame-ancestors ${rendered}`);
    }
  }

  return { blocked: reasons.length > 0, reasons };
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
 * Run a single probe of the embed URL. Follows redirects so we inspect the
 * framing headers of the document the iframe would actually render. A 5xx or
 * a thrown error (timeout/DNS/network) is classified `unreachable` — that's
 * the transient, inconclusive bucket the caller must not treat as a block.
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
      // Server-side error — the embed health is inconclusive, don't treat
      // a 503 as "framing is fine".
      return {
        status: "unreachable",
        reasons: [],
        error: `http_${res.status}`,
        httpStatus: res.status,
      };
    }
    const analysis = analyzeFramingHeaders(res.headers);
    if (analysis.blocked) {
      return {
        status: "blocked",
        reasons: analysis.reasons,
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
    p.reasons.length > 0 ? p.reasons.join("; ") : "framing-blocking headers";
  const summary =
    p.kind === "fire"
      ? `Live Chat embed is blocked — ${p.url} is sending framing-blocking headers (${reasonText})`
      : `Live Chat embed recovered — ${p.url} no longer blocks in-portal framing`;
  const emailText =
    p.kind === "fire"
      ? [
          `The portal embeds Live Chat (${p.url}) in an in-page iframe, but that URL has`,
          `returned framing-blocking headers for ${p.consecutiveBlocked} consecutive probe(s)`,
          `(threshold ${p.threshold}).`,
          "",
          `Blocking headers: ${reasonText}.`,
          "",
          "Real members now hit the 8s client-side watchdog and get bounced to a new tab",
          "instead of the in-page chat. Check whether TicketDesk changed its",
          "X-Frame-Options / CSP frame-ancestors policy, and add the portal origin back",
          "to the allowed ancestors.",
          "",
          `First detected blocked at: ${p.lastBlockedAt ?? "n/a"}.`,
          "Confirm via /admin/system (Live Chat embed card).",
        ].join("\n")
      : [
          `The Live Chat embed (${p.url}) is framing-allowed again — a recent probe`,
          "loaded without framing-blocking headers. Marking the alert resolved.",
          "",
          "Confirm via /admin/system.",
        ].join("\n");
  const slackText =
    p.kind === "fire"
      ? `:rotating_light: *Live Chat embed is blocked* — ${p.url} sent framing-blocking headers ${p.consecutiveBlocked}× in a row (threshold ${p.threshold}). ${reasonText}. Members are bounced to a new tab. Check /admin/system.`
      : `:white_check_mark: *Live Chat embed recovered* — ${p.url} no longer blocks in-portal framing.`;
  return {
    pagerduty: {
      // Stable dedup key so re-fires fold into one incident and the resolve
      // auto-closes it.
      dedupKey: "live-chat-embed:blocked",
      summary,
      severity: "error",
      component: "live-chat-embed",
      class: "live_chat_embed_blocked",
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
          ? "[ALERT] Live Chat embed is blocked in the portal"
          : "[RESOLVED] Live Chat embed recovered",
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
  // Separate throttle slots for fire vs clear per channel so a recovery
  // notification is never suppressed by a recent page.
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
 *
 * Safe to call frequently — re-fires while alerting are gated by the shared
 * dispatcher's per-channel throttle.
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
 * the embed's status without re-deriving the transition logic.
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

/** Start the embed probe poll. Idempotent. */
export function startLiveChatEmbedProbe(): void {
  runner.start();
}

/** Stop the embed probe poll. */
export function stopLiveChatEmbedProbe(): void {
  runner.stop();
}
