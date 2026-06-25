/**
 * TicketDesk HTTP client — programmatic conversation creation via the chat
 * session API.
 *
 * ## Verified API contract (reverse-engineered from the live widget.js)
 *
 * TicketDesk (tickets.buildtestscale.com) does NOT expose a REST endpoint for
 * programmatically creating threads from external systems.  The previous client
 * called `POST /api/v1/workspaces/{workspaceId}/conversations`, which does not
 * exist (returns 404 "Cannot POST" — confirmed against the live instance).
 *
 * The correct mechanism is the **public chat session API**, the same API the
 * TicketDesk live-chat widget uses:
 *
 *   Step 1: POST /api/chat/session
 *     Body: { workspaceId, email, name, externalId?, pageUrl?, locale? }
 *     Response: { sessionToken: "<token>" }
 *     → creates (or finds) a thread for the contact in TicketDesk.
 *
 *   Step 2: POST /api/chat/messages
 *     Header: Authorization: Bearer <sessionToken>
 *     Body: { bodyText: "<message text>" }
 *     Response: { id: "<messageId>", threadId?: "<threadId>", ... }
 *     → posts the opening message into the thread.
 *
 * ## Origin restriction
 *
 * TicketDesk validates the `Origin` request header against the workspace's
 * configured allowed-origin list (set in TicketDesk workspace → Chat Config).
 * Server-to-server calls from the BTS API server will be rejected (403
 * "Origin not allowed") until the portal's domain is added to that list.
 *
 * ## Required account-owner action (one-time setup)
 * 1. Log in to TicketDesk as a workspace admin.
 * 2. Go to Settings → Chat Config (or similar).
 * 3. Add `https://portal.buildtestscale.com` to the list of allowed origins.
 *    This enables the BTS API server to create chat sessions programmatically.
 * 4. Optionally set TICKETDESK_CHAT_ORIGIN to the actual API server origin
 *    if it differs from the portal URL.
 *
 * ## Configuration (env vars)
 *
 *   TICKETDESK_CHAT_ORIGIN  — Origin header sent with every chat API request.
 *                             Must match one of the workspace's allowed origins
 *                             in TicketDesk settings.
 *                             Default: https://portal.buildtestscale.com
 *
 *   TICKETDESK_API_URL      — API base URL (default: https://tickets.buildtestscale.com/api)
 *   TICKETDESK_WORKSPACE_ID — Workspace UUID (default: from @workspace/support-config)
 *
 * ## Cross-reference for inbound reply webhooks
 *
 * The BTS ticket number (e.g. "BTS-123456") is passed as `externalId` in the
 * session creation call AND embedded in the first message body as a labelled
 * reference line.  The inbound webhook parser (`parseInboundReply`) looks for
 * the BTS number in several places in the webhook payload, so either channel
 * provides reliable round-trip matching.
 *
 * ## Backward compatibility
 *
 * TICKETDESK_API_KEY — no longer needed for the chat session path; kept as a
 * documented no-op so callers that set it don't break.  `isConfigured()` now
 * returns true unconditionally (the session API requires no key) so delivery
 * is always attempted when the queue is enabled.
 */

import crypto from "crypto";
import {
  DEFAULT_TICKETDESK_WIDGET_API_URL,
  DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID,
} from "@workspace/support-config";

/**
 * Resolve the TicketDesk config fresh from the environment on each call so the
 * delivery path (`createConversation`) and the health probe (`probeDeliveryGate`)
 * can never disagree about which API URL / workspace / Origin they use — a
 * divergence would make the probe's verdict meaningless.
 */
function resolveApiUrl(): string {
  return process.env.TICKETDESK_API_URL || DEFAULT_TICKETDESK_WIDGET_API_URL;
}

function resolveWorkspaceId(): string {
  return (
    process.env.TICKETDESK_WORKSPACE_ID || DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID
  );
}

/**
 * Origin header sent with every chat API request. Must match an entry in the
 * TicketDesk workspace's allowed-origins list (Chat Config settings).
 *
 * Default: https://portal.buildtestscale.com
 * Override via: TICKETDESK_CHAT_ORIGIN=<url>
 */
function resolveChatOrigin(): string {
  return (
    process.env.TICKETDESK_CHAT_ORIGIN ||
    process.env.PORTAL_URL ||
    "https://portal.buildtestscale.com"
  );
}

/** The Origin header value delivery (and the health probe) send to TicketDesk. */
export function getTicketDeskChatOrigin(): string {
  return resolveChatOrigin();
}

// Shared secret used to verify inbound TicketDesk webhook deliveries.
function getWebhookSecret(): string {
  return process.env.TICKETDESK_WEBHOOK_SECRET || "";
}

export interface TicketDeskConversationInput {
  /** Member's email — used as the contact identifier (getOrCreate). */
  contactEmail: string;
  /** Member's display name. */
  contactName: string;
  /** Ticket subject line. */
  subject: string;
  /** Full message body from the member. */
  body: string;
  /** BTS portal ticket number (e.g. "BTS-123456") for cross-reference. */
  btsTicketNumber: string;
  /** Internal DB id of the portal ticket row — used by the queue worker to
   * update the delivery_status column after each attempt. Optional for
   * backward compatibility with any callers that don't yet supply it. */
  ticketId?: number;
}

export interface TicketDeskConversationResult {
  /** TicketDesk session token (used as the "conversation id" reference). */
  id: string;
  /** TicketDesk message id from the first posted message. */
  conversationNumber?: string | number;
}

/**
 * Returns true — the chat session API requires no API key.
 * Kept for interface compatibility with the queue worker.
 */
export function isConfigured(): boolean {
  return true;
}

/**
 * Creates a new thread in TicketDesk for the member's support ticket.
 *
 * Uses the two-step chat session API (the same mechanism as the live-chat
 * widget):
 *   1. POST /api/chat/session  → sessionToken
 *   2. POST /api/chat/messages → first message (the ticket body)
 *
 * Throws on any non-2xx response (including the 403 "Origin not allowed" that
 * appears until the account owner whitelists the portal domain in TicketDesk
 * settings) so the BullMQ worker can retry.
 */
export async function createConversation(
  input: TicketDeskConversationInput,
): Promise<TicketDeskConversationResult> {
  const apiUrl = resolveApiUrl();
  const chatOrigin = resolveChatOrigin();
  const sessionUrl = `${apiUrl}/chat/session`;
  const portalTicketUrl = `${chatOrigin}/support/tickets/${input.btsTicketNumber}`;

  const sessionPayload = {
    workspaceId: resolveWorkspaceId(),
    email: input.contactEmail,
    name: input.contactName,
    externalId: input.btsTicketNumber,
    pageUrl: portalTicketUrl,
    locale: "en",
  };

  const sessionResponse = await fetch(sessionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: chatOrigin,
    },
    body: JSON.stringify(sessionPayload),
  });

  if (!sessionResponse.ok) {
    const errorText = await sessionResponse.text().catch(() => "(no body)");
    if (sessionResponse.status === 403 && errorText.includes("Origin not allowed")) {
      throw new Error(
        `TicketDesk rejected origin "${chatOrigin}" (403 Origin not allowed). ` +
          `The portal domain must be added to the TicketDesk workspace's allowed-origins list ` +
          `in Settings → Chat Config. ` +
          `Override the origin via TICKETDESK_CHAT_ORIGIN if the API server uses a different domain.`,
      );
    }
    throw new Error(
      `TicketDesk POST ${sessionUrl} failed (${sessionResponse.status}): ${errorText}`,
    );
  }

  const sessionData = (await sessionResponse.json()) as Record<string, unknown>;
  const sessionToken = sessionData.sessionToken as string;

  if (!sessionToken) {
    throw new Error(
      `TicketDesk session response missing sessionToken: ${JSON.stringify(sessionData)}`,
    );
  }

  // Build the message body: include the subject and BTS reference so agents
  // see the context immediately, and so the inbound webhook parser can match
  // replies back to the correct portal ticket.
  const messageBody = [
    `Subject: ${input.subject}`,
    `BTS Ticket: ${input.btsTicketNumber}`,
    `Portal URL: ${portalTicketUrl}`,
    ``,
    input.body,
  ].join("\n");

  const messageUrl = `${apiUrl}/chat/messages`;

  const messageResponse = await fetch(messageUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
      Origin: chatOrigin,
    },
    body: JSON.stringify({ bodyText: messageBody }),
  });

  if (!messageResponse.ok) {
    const errorText = await messageResponse.text().catch(() => "(no body)");
    throw new Error(
      `TicketDesk POST ${messageUrl} failed (${messageResponse.status}): ${errorText}`,
    );
  }

  const messageData = (await messageResponse.json()) as Record<string, unknown>;

  return {
    id: sessionToken,
    conversationNumber: String(messageData.id ?? messageData.threadId ?? ""),
  };
}

/* ------------------------------------------------------------------------- *
 * Delivery-gate health probe
 *
 * Programmatic ticket delivery (createConversation) only works while the portal
 * domain stays on TicketDesk's allowed-origins list. If that entry is removed
 * (or the portal domain changes) the session POST starts failing with a 403
 * "Origin not allowed" and every member ticket silently piles up undelivered,
 * retrying forever. The widget-embed probe (live-chat-embed-probe.ts) only
 * GETs widget.js — it never exercises this origin gate.
 *
 * `probeDeliveryGate` POSTs to /api/chat/session with the EXACT same Origin
 * header, API URL, and workspace that createConversation sends, so its verdict
 * always matches what real delivery would experience:
 *
 *   - 403 "Origin not allowed"  → `blocked`     (delivery is broken — page on-call)
 *   - 2xx                        → `ok`          (gate open; session created/reused)
 *   - other 4xx                  → `ok`          (origin accepted; we reached request
 *                                                 validation, so the gate is NOT the problem)
 *   - 5xx / network / timeout / other 403 → `unreachable` (inconclusive; never alarms)
 *
 * Minimal footprint: the probe uses a dedicated, clearly-labelled probe contact
 * (stable email + non-BTS externalId). TicketDesk's chat session API is
 * get-or-create by contact, so every run reuses the SAME single thread instead
 * of spawning a fresh one in the agent inbox, and the non-BTS externalId can
 * never collide with a real portal ticket's inbound-reply matching. Only the
 * session step runs — no message is posted.
 * ------------------------------------------------------------------------- */

/** Stable reference for the probe's session — deliberately NOT a BTS-\d+ id so
 * the inbound-reply parser can never mis-match it to a real portal ticket. */
const DELIVERY_PROBE_EXTERNAL_ID = "SYSTEM-HEALTH-PROBE";

function resolveProbeEmail(): string {
  return (
    process.env.TICKETDESK_DELIVERY_PROBE_EMAIL ||
    "system-health-probe@buildtestscale.com"
  );
}

function resolveProbeName(): string {
  return (
    process.env.TICKETDESK_DELIVERY_PROBE_NAME ||
    "BTS System Health Probe (automated — ignore)"
  );
}

export type DeliveryGateStatus = "ok" | "blocked" | "unreachable";

export interface DeliveryGateProbeResult {
  status: DeliveryGateStatus;
  /** Final HTTP status when a response arrived, else null. */
  httpStatus: number | null;
  /** Short human reason when blocked (e.g. "Origin not allowed"), else null. */
  reason: string | null;
  /** Short error description when unreachable, else null. */
  error: string | null;
  /** The Origin header the probe sent — identical to what delivery sends. */
  origin: string;
  /**
   * Session token returned by a successful (2xx) chat-session creation, used by
   * the best-effort thread cleanup. Null on any non-2xx result, or when the 2xx
   * body carried no parseable token (e.g. a stubbed test response).
   */
  sessionToken: string | null;
  /** Thread id returned alongside the session token on a 2xx, else null. */
  threadId: string | null;
}

function describeProbeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/**
 * Run a single probe of the TicketDesk chat-session origin gate. Mirrors the
 * session step of `createConversation` so a 403 "Origin not allowed" here means
 * real delivery is currently blocked.
 */
export async function probeDeliveryGate(opts?: {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<DeliveryGateProbeResult> {
  const origin = resolveChatOrigin();
  const sessionUrl = `${resolveApiUrl()}/chat/session`;
  const doFetch = opts?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 8_000);
  try {
    const res = await doFetch(sessionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
      },
      body: JSON.stringify({
        workspaceId: resolveWorkspaceId(),
        email: resolveProbeEmail(),
        name: resolveProbeName(),
        externalId: DELIVERY_PROBE_EXTERNAL_ID,
        pageUrl: `${origin}/admin/system`,
        locale: "en",
      }),
      signal: controller.signal,
    });

    if (res.status === 403) {
      const text = await res.text().catch(() => "");
      if (/origin not allowed/i.test(text)) {
        return {
          status: "blocked",
          httpStatus: 403,
          reason: "Origin not allowed",
          error: null,
          origin,
          sessionToken: null,
          threadId: null,
        };
      }
      // Some other 403 (auth, rate-limit, etc.) — not the origin gate; hold
      // inconclusive so we never false-alarm the delivery-blocked alert.
      return {
        status: "unreachable",
        httpStatus: 403,
        reason: null,
        error: "http_403",
        origin,
        sessionToken: null,
        threadId: null,
      };
    }

    if (res.status >= 500) {
      // Server error — likely transient; inconclusive.
      return {
        status: "unreachable",
        httpStatus: res.status,
        reason: null,
        error: `http_${res.status}`,
        origin,
        sessionToken: null,
        threadId: null,
      };
    }

    // 2xx, or any non-403 4xx: either the session was created/reused, or we
    // reached request validation — both prove the origin gate let us through,
    // so programmatic delivery is NOT origin-blocked.
    //
    // On a real 2xx the body carries { sessionToken, threadId, ... }; capture
    // them so the caller can best-effort archive the probe thread. Parse
    // defensively — a non-2xx-but-ok (non-403 4xx) or a stubbed test body may
    // not be JSON, in which case we simply have no token and cleanup no-ops.
    let sessionToken: string | null = null;
    let threadId: string | null = null;
    if (res.status >= 200 && res.status < 300) {
      try {
        const data = (await res.text().then((t) => JSON.parse(t))) as Record<
          string,
          unknown
        >;
        if (typeof data.sessionToken === "string") sessionToken = data.sessionToken;
        if (typeof data.threadId === "string") threadId = data.threadId;
      } catch {
        // Non-JSON / empty body — leave token null; cleanup will no-op.
      }
    }
    return {
      status: "ok",
      httpStatus: res.status,
      reason: null,
      error: null,
      origin,
      sessionToken,
      threadId,
    };
  } catch (err) {
    return {
      status: "unreachable",
      httpStatus: null,
      reason: null,
      error: describeProbeError(err),
      origin,
      sessionToken: null,
      threadId: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------- *
 * Delivery-probe thread cleanup (best-effort, opt-in)
 *
 * The delivery-gate probe creates/reuses ONE dedicated chat session/thread for
 * the probe contact (system-health-probe@buildtestscale.com) every run. That
 * thread lingers in the TicketDesk agent inbox. Ideally we would archive/close
 * it automatically so agents never see it in their active queue.
 *
 * VERIFIED (2026-06-16, direct calls to the live tickets.buildtestscale.com
 * instance with the portal Origin): the external TicketDesk chat API exposes NO
 * REST endpoint that a contact / external system can use to resolve, close, or
 * archive a thread. Every candidate 404s —
 *   POST /chat/session/{resolve,close,archive,end}, PATCH /chat/session,
 *   DELETE /chat/session, POST|PATCH /chat/threads/{id}{,/resolve,/close} —
 * and the live widget drives close/typing/status purely over a WebSocket agent
 * channel. Closing a conversation is an AGENT-side action; there is nothing for
 * us to call today.
 *
 * Mitigating footprint that already exists (do NOT "fix" by deleting the
 * contact — the probe just recreates it, and a stable contact is exactly what
 * keeps every run on ONE thread instead of flooding the inbox with new ones):
 *   - the probe posts NO message (GET /chat/messages on the probe thread
 *     returns an empty list), so the thread stays empty;
 *   - the contact is clearly labelled "BTS System Health Probe (automated —
 *     ignore)";
 *   - get-or-create reuses the same single thread across all runs.
 *
 * This function is therefore a ready-to-enable hook: it is a no-op unless an
 * operator sets TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH to a real archive/close
 * endpoint (should TicketDesk ever expose one). When configured it POSTs to
 * `${apiUrl}${path}` with the probe's session token, swallowing every failure —
 * it never throws and never affects the probe's health verdict.
 * ------------------------------------------------------------------------- */

/** Path (relative to the TicketDesk API base) of a thread archive/close/resolve
 * endpoint. Empty by default because the live instance exposes none; set this to
 * enable automatic probe-thread cleanup if TicketDesk later adds one. */
function resolveProbeResolvePath(): string {
  return (process.env.TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH || "").trim();
}

/** HTTP method used for the cleanup call (default POST). */
function resolveProbeResolveMethod(): string {
  const raw = (process.env.TICKETDESK_DELIVERY_PROBE_RESOLVE_METHOD || "").trim();
  return raw.length > 0 ? raw.toUpperCase() : "POST";
}

export interface DeliveryProbeCleanupResult {
  /** Whether a cleanup request was actually issued (false when unconfigured). */
  attempted: boolean;
  /** Whether the cleanup request returned a 2xx. */
  ok: boolean;
  /** Final HTTP status when a response arrived, else null. */
  httpStatus: number | null;
  /** Short error/skip reason, else null. */
  error: string | null;
}

/**
 * Best-effort archive/close of the dedicated delivery-probe thread.
 *
 * No-op (attempted: false) unless TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH is set
 * and a session token is available. Never throws — any failure (missing token,
 * 4xx/5xx, network/timeout) is captured in the result so the probe's verdict is
 * never affected.
 */
export async function archiveDeliveryProbeThread(opts: {
  sessionToken: string | null | undefined;
  threadId?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<DeliveryProbeCleanupResult> {
  const path = resolveProbeResolvePath();
  if (!path) {
    return { attempted: false, ok: false, httpStatus: null, error: "no_endpoint_configured" };
  }
  if (!opts.sessionToken) {
    return { attempted: false, ok: false, httpStatus: null, error: "no_session_token" };
  }

  const url = `${resolveApiUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const origin = resolveChatOrigin();
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8_000);
  try {
    const res = await doFetch(url, {
      method: resolveProbeResolveMethod(),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.sessionToken}`,
        Origin: origin,
      },
      body: JSON.stringify({
        status: "resolved",
        archived: true,
        threadId: opts.threadId ?? undefined,
      }),
      signal: controller.signal,
    });
    return {
      attempted: true,
      ok: res.ok,
      httpStatus: res.status,
      error: res.ok ? null : `http_${res.status}`,
    };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      httpStatus: null,
      error: describeProbeError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------- *
 * Polling helpers: fetch messages from an existing TicketDesk thread.
 *
 * TicketDesk does not expose an outgoing webhook registration API — the admin
 * webhook endpoints (e.g. /api/admin/webhooks) return 404 on the live instance.
 * The platform delivers messages to the browser widget via WebSocket and a REST
 * polling API.  We reuse that polling API server-side:
 *
 *   POST /api/chat/session  (with email + externalId = BTS ticket number)
 *     → idempotent get-or-create: always returns the same thread for the same
 *       (email, externalId) pair, so we never need to store the session token
 *       between polls.
 *
 *   GET /api/chat/messages?limit=N   (Authorization: Bearer <sessionToken>)
 *     → returns all messages in the thread.  Agent messages have
 *       type "chat_outbound" or "outbound"; contact messages are "chat_inbound".
 * -------------------------------------------------------------------------- */

/** A single message as returned by GET /api/chat/messages. */
export interface TicketDeskThreadMessage {
  /** TicketDesk's stable message id — used as the dedup key. */
  id: string;
  /**
   * Message direction from TicketDesk's perspective.
   * Agent (support staff) messages: "chat_outbound" | "outbound"
   * Contact (member) messages:      "chat_inbound"  | "inbound"
   */
  type: string;
  /** Message body text (may be in bodyText or body). */
  body: string;
  /** ISO timestamp from TicketDesk, if present. */
  createdAt?: string;
}

/**
 * The author/type values that indicate a message came from the agent (support
 * staff) side of the conversation.  Contact-side messages (the member's own
 * messages echoed from the widget) must be skipped to avoid re-appending them
 * to the portal thread.
 */
const AGENT_MESSAGE_TYPES = new Set([
  "chat_outbound",
  "outbound",
  "agent_message",
]);

/**
 * Returns true when a thread message came from the support-agent side.
 * Excludes contact/member messages and any unknown types.
 */
export function isAgentMessage(msg: TicketDeskThreadMessage): boolean {
  return AGENT_MESSAGE_TYPES.has(msg.type?.toLowerCase?.() ?? "");
}

/**
 * Re-creates (or re-uses) a TicketDesk chat session for the given member +
 * BTS ticket number and returns the session token.
 *
 * The chat session API is get-or-create keyed by (email, externalId), so
 * calling this multiple times for the same ticket always returns a token that
 * grants access to the same underlying thread — no stored credential required.
 *
 * Throws on any non-2xx response so callers can skip the ticket gracefully.
 */
export async function createSessionForPolling(opts: {
  email: string;
  btsTicketNumber: string;
}): Promise<string> {
  const apiUrl = resolveApiUrl();
  const chatOrigin = resolveChatOrigin();

  const res = await fetch(`${apiUrl}/chat/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: chatOrigin,
    },
    body: JSON.stringify({
      workspaceId: resolveWorkspaceId(),
      email: opts.email,
      name: "",
      externalId: opts.btsTicketNumber,
      pageUrl: `${chatOrigin}/support/tickets/${opts.btsTicketNumber}`,
      locale: "en",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(
      `TicketDesk session POST failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as Record<string, unknown>;
  const token = data.sessionToken as string | undefined;
  if (!token) {
    throw new Error(
      `TicketDesk session response missing sessionToken: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return token;
}

/**
 * Fetches all messages from the TicketDesk thread associated with the given
 * session token, normalised into TicketDeskThreadMessage objects.
 *
 * Tolerates multiple possible field layouts:
 *   - bodyText  (the field used when sending messages)
 *   - body      (common alternate)
 *   - text      (another common alias)
 */
export async function fetchThreadMessages(
  sessionToken: string,
  limit = 100,
): Promise<TicketDeskThreadMessage[]> {
  const apiUrl = resolveApiUrl();
  const chatOrigin = resolveChatOrigin();

  const res = await fetch(`${apiUrl}/chat/messages?limit=${limit}`, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      Origin: chatOrigin,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(
      `TicketDesk GET messages failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as Record<string, unknown>;
  const raw = Array.isArray(data.messages)
    ? (data.messages as Record<string, unknown>[])
    : Array.isArray(data)
      ? (data as Record<string, unknown>[])
      : [];

  return raw
    .map((m): TicketDeskThreadMessage | null => {
      const id = String(m.id ?? "").trim();
      const type = String(m.type ?? "").trim();
      const body = String(
        m.bodyText ?? m.body ?? m.text ?? m.content ?? "",
      ).trim();
      if (!id || !body) return null;
      return {
        id,
        type,
        body,
        createdAt:
          typeof m.createdAt === "string"
            ? m.createdAt
            : typeof m.timestamp === "string"
              ? m.timestamp
              : undefined,
      };
    })
    .filter((m): m is TicketDeskThreadMessage => m !== null);
}

/* ------------------------------------------------------------------------- *
 * Thread-status detection
 *
 * TicketDesk does not expose a dedicated "conversation status" endpoint in the
 * public chat session API, but the GET /api/chat/messages response sometimes
 * includes a top-level `status` field (e.g. "open", "resolved", "closed") and
 * the thread may contain system messages that indicate the conversation was
 * closed by an agent.  We inspect both signals:
 *
 *   1. A `status` / `conversationStatus` / `threadStatus` field on the raw
 *      messages-response body.
 *   2. System-type messages whose body contains closure keywords — the same
 *      mechanism that shows "Conversation closed" in chat widget UIs.
 *
 * Neither signal is guaranteed, so `detectThreadClosed` is best-effort and
 * returns false when there is no clear evidence of closure.
 * ------------------------------------------------------------------------- */

const CLOSED_STATUS_VALUES = new Set([
  "closed",
  "resolved",
  "done",
  "completed",
  "archived",
]);

const SYSTEM_MESSAGE_TYPES = new Set([
  "activity",
  "system",
  "event",
  "bot",
  "conversation_status_changed",
  "status_changed",
  "chat_status",
]);

const CLOSURE_BODY_PATTERNS = [
  /conversation\s+(was\s+)?(closed|resolved)/i,
  /ticket\s+(was\s+)?(closed|resolved)/i,
  /chat\s+(was\s+)?(closed|resolved)/i,
  /^closed$/i,
  /^resolved$/i,
  /marked\s+as\s+(closed|resolved)/i,
];

/** Returns true when the message looks like a system "conversation closed" event. */
function isClosureSystemMessage(msg: TicketDeskThreadMessage): boolean {
  if (!SYSTEM_MESSAGE_TYPES.has(msg.type?.toLowerCase?.() ?? "")) return false;
  return CLOSURE_BODY_PATTERNS.some((re) => re.test(msg.body));
}

/**
 * Returns true when the raw messages-response body contains a top-level status
 * field that indicates the conversation is closed/resolved.
 */
export function detectThreadClosed(
  messages: TicketDeskThreadMessage[],
  rawResponseData?: Record<string, unknown>,
): boolean {
  if (rawResponseData) {
    const statusField = String(
      rawResponseData.status ??
        rawResponseData.conversationStatus ??
        rawResponseData.threadStatus ??
        rawResponseData.state ??
        "",
    ).toLowerCase();
    if (statusField && CLOSED_STATUS_VALUES.has(statusField)) return true;

    const conversation = rawResponseData.conversation as Record<string, unknown> | undefined;
    if (conversation) {
      const convStatus = String(
        conversation.status ?? conversation.state ?? "",
      ).toLowerCase();
      if (convStatus && CLOSED_STATUS_VALUES.has(convStatus)) return true;
    }
  }

  return messages.some((m) => isClosureSystemMessage(m));
}

/* ------------------------------------------------------------------------- *
 * Posting messages / closing conversations
 *
 * `postMessageToThread` sends a message into an existing chat thread.
 * `signalResolutionToTicketDesk` is the "member marked resolved" notification:
 *   - first tries any close/resolve API if TicketDesk ever exposes one,
 *   - falls back to posting a labelled human-readable message into the thread.
 *
 * Both are best-effort — callers swallow their errors so a TicketDesk
 * failure never blocks the portal status change.
 * ------------------------------------------------------------------------- */

/**
 * Posts a message into an existing TicketDesk thread.
 * Reuses (or re-creates) the session token for the given email + ticket number.
 */
export async function postMessageToThread(opts: {
  sessionToken: string;
  messageText: string;
}): Promise<void> {
  const apiUrl = resolveApiUrl();
  const chatOrigin = resolveChatOrigin();

  const res = await fetch(`${apiUrl}/chat/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.sessionToken}`,
      Origin: chatOrigin,
    },
    body: JSON.stringify({ bodyText: opts.messageText }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(
      `TicketDesk POST message failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
}

/**
 * Attempts to close/resolve a TicketDesk conversation via known candidate
 * API endpoints.  TicketDesk's public chat session API does not document a
 * dedicated close endpoint, so we probe common patterns and return true on
 * the first 2xx response.  Returns false (never throws) when every attempt
 * fails (404, 405, 4xx, network errors) — callers should fall back to posting
 * a labelled message.
 *
 * Candidate paths (tried in order):
 *   PATCH /api/chat/conversations/{sessionToken}  { status: "resolved" }
 *   POST  /api/chat/sessions/{sessionToken}/resolve
 *   POST  /api/chat/sessions/{sessionToken}/close
 *   PUT   /api/chat/conversations/{sessionToken}/status  { status: "resolved" }
 */
async function tryCloseTicketDeskConversation(
  sessionToken: string,
): Promise<boolean> {
  const apiUrl = resolveApiUrl();
  const chatOrigin = resolveChatOrigin();

  const baseHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${sessionToken}`,
    Origin: chatOrigin,
  };

  const candidates: Array<{ method: string; path: string; body?: string }> = [
    {
      method: "PATCH",
      path: `${apiUrl}/chat/conversations/${sessionToken}`,
      body: JSON.stringify({ status: "resolved" }),
    },
    {
      method: "POST",
      path: `${apiUrl}/chat/sessions/${sessionToken}/resolve`,
    },
    {
      method: "POST",
      path: `${apiUrl}/chat/sessions/${sessionToken}/close`,
    },
    {
      method: "PUT",
      path: `${apiUrl}/chat/conversations/${sessionToken}/status`,
      body: JSON.stringify({ status: "resolved" }),
    },
  ];

  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate.path, {
        method: candidate.method,
        headers: baseHeaders,
        body: candidate.body,
      });
      if (res.ok) {
        console.log(
          `[TicketDesk] Conversation closed via ${candidate.method} ${candidate.path}`,
        );
        return true;
      }
      // 404/405 = endpoint doesn't exist; try next candidate silently
      // Other 4xx/5xx = endpoint exists but rejected; also try next
    } catch {
      // Network error; try next candidate
    }
  }

  return false;
}

/**
 * Signals TicketDesk that the member marked a ticket as resolved.
 *
 * Strategy:
 *   1. Try several candidate close/resolve API endpoints (the exact path varies
 *      by TicketDesk version and is not publicly documented). Returns true on
 *      the first 2xx; all failures are silently swallowed.
 *   2. When no close endpoint works, falls back to posting a clearly-labelled
 *      "Member marked this issue as resolved" message into the thread so the
 *      agent inbox always reflects the member's action regardless of whether a
 *      programmatic close API exists.
 *
 * Throws only when even the fallback message post fails.
 */
export async function signalResolutionToTicketDesk(opts: {
  email: string;
  btsTicketNumber: string;
  memberName?: string;
}): Promise<void> {
  const sessionToken = await createSessionForPolling({
    email: opts.email,
    btsTicketNumber: opts.btsTicketNumber,
  });

  // Try to close the conversation via a dedicated API endpoint first.
  const closed = await tryCloseTicketDeskConversation(sessionToken);

  if (!closed) {
    // No close API found — post a clearly-labelled message as a guaranteed
    // fallback so the support team always sees the member's action.
    const fallbackMessage =
      `[Member marked this issue as resolved]\n\n` +
      `The member has indicated that their issue is resolved. ` +
      `BTS Ticket: ${opts.btsTicketNumber}`;

    await postMessageToThread({
      sessionToken,
      messageText: fallbackMessage,
    });
  }
}

/**
 * Mirrors a member's portal reply into the existing TicketDesk thread so the
 * support agent sees it in their inbox.  Re-obtains (or creates) the chat
 * session for the member + ticket — the session API is get-or-create keyed by
 * (email, externalId), so this always targets the same underlying thread the
 * original submission created — then posts the reply text.
 *
 * Best-effort: throws on any failure so the caller can log it, but callers must
 * swallow the error so a TicketDesk outage never blocks the member's reply from
 * being saved in the portal.  The posted message comes back from TicketDesk as
 * a contact/inbound message, so the reply poller's isAgentMessage filter skips
 * it and it is never echoed back into the portal thread.
 */
export async function sendMemberReplyToTicketDesk(opts: {
  email: string;
  btsTicketNumber: string;
  messageText: string;
}): Promise<void> {
  const sessionToken = await createSessionForPolling({
    email: opts.email,
    btsTicketNumber: opts.btsTicketNumber,
  });
  await postMessageToThread({
    sessionToken,
    messageText: opts.messageText,
  });
}

/**
 * Extended version of fetchThreadMessages that also returns the raw response
 * body so callers can inspect top-level status fields for closure detection.
 */
export async function fetchThreadMessagesWithMeta(
  sessionToken: string,
  limit = 100,
): Promise<{
  messages: TicketDeskThreadMessage[];
  rawData: Record<string, unknown>;
}> {
  const apiUrl = resolveApiUrl();
  const chatOrigin = resolveChatOrigin();

  const res = await fetch(`${apiUrl}/chat/messages?limit=${limit}`, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      Origin: chatOrigin,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(
      `TicketDesk GET messages failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }

  const rawData = (await res.json()) as Record<string, unknown>;
  const raw = Array.isArray(rawData.messages)
    ? (rawData.messages as Record<string, unknown>[])
    : Array.isArray(rawData)
      ? (rawData as Record<string, unknown>[])
      : [];

  const messages = raw
    .map((m): TicketDeskThreadMessage | null => {
      const id = String(m.id ?? "").trim();
      const type = String(m.type ?? "").trim();
      const body = String(
        m.bodyText ?? m.body ?? m.text ?? m.content ?? "",
      ).trim();
      if (!id || !body) return null;
      return {
        id,
        type,
        body,
        createdAt:
          typeof m.createdAt === "string"
            ? m.createdAt
            : typeof m.timestamp === "string"
              ? m.timestamp
              : undefined,
      };
    })
    .filter((m): m is TicketDeskThreadMessage => m !== null);

  return { messages, rawData };
}

/* ------------------------------------------------------------------------- *
 * Inbound webhook: closure-event detection
 *
 * TicketDesk may deliver a webhook event when an agent closes a conversation
 * (e.g. event type "conversation.resolved", "conversation.closed", or a
 * "status_changed" event with a resolved/closed value). These events often
 * have no reply body, so `parseInboundReply` returns null for them — but we
 * still need to mirror the resolution back to the portal ticket.
 *
 * `parseInboundClosure` inspects the webhook payload independently of
 * `parseInboundReply`. It returns the BTS ticket number when:
 *   1. The event type clearly indicates closure (see CLOSURE_EVENT_TYPES), or
 *   2. The payload contains a conversation/thread status that is a closed value.
 *
 * Callers should check this BEFORE attempting to parse as a reply so the
 * webhook handler can resolve the ticket even when there is no message body.
 * -------------------------------------------------------------------------- */

const CLOSURE_EVENT_TYPES = new Set([
  "conversation.resolved",
  "conversation.closed",
  "conversation.done",
  "conversation.completed",
  "conversation.status_changed",
  "ticket.resolved",
  "ticket.closed",
  "chat.closed",
  "chat.resolved",
  "status_changed",
]);

/**
 * Returns the BTS ticket number when the webhook payload represents a
 * conversation-closure event, or null when this payload is not a closure.
 *
 * A payload is treated as closure when:
 *   - Its event/type field matches a known closure event type AND
 *   - The conversation/thread/payload status or new_status is a closed value.
 * OR:
 *   - Its event/type is a known closure-only event type (e.g.
 *     "conversation.resolved") regardless of an explicit status field.
 */
export function parseInboundClosure(
  payload: Record<string, unknown>,
): string | null {
  const data = asRecord(payload.data);
  const conversation = asRecord(
    payload.conversation ?? data.conversation ?? payload.thread ?? data.thread,
  );

  const eventTypeRaw = firstString(
    payload.event,
    payload.type,
    data.event,
    data.type,
  )
    .trim()
    .toLowerCase();

  if (!eventTypeRaw) return null;

  // Check if this is a recognised closure event type.
  const isClosureEventType = CLOSURE_EVENT_TYPES.has(eventTypeRaw);

  // For "status_changed" events we also need to see the new status is closed.
  let hasClosedStatus = false;
  if (isClosureEventType) {
    const newStatus = String(
      payload.new_status ??
        data.new_status ??
        payload.status ??
        data.status ??
        conversation.status ??
        conversation.state ??
        "",
    )
      .trim()
      .toLowerCase();

    // Any event type containing "status_changed" is a generic status transition
    // (e.g. "status_changed", "conversation.status_changed") — it only counts
    // as closure when the new status is explicitly a closed value.
    // Dedicated closure events (e.g. "conversation.resolved", "ticket.closed")
    // imply closure unconditionally without needing a status field.
    if (eventTypeRaw.includes("status_changed")) {
      hasClosedStatus = newStatus !== "" && CLOSED_STATUS_VALUES.has(newStatus);
    } else {
      hasClosedStatus = true;
    }
  }

  if (!isClosureEventType || !hasClosedStatus) return null;

  // Extract the BTS ticket number from the usual locations.
  const btsTicketNumber =
    firstString(
      payload.reference,
      data.reference,
      conversation.reference,
      conversation.externalId,
      payload.externalId,
      data.externalId,
      payload.btsTicketNumber,
      data.btsTicketNumber,
    ).trim() ||
    extractBtsTicketNumber(
      firstString(
        conversation.subject,
        payload.subject,
        data.subject,
      ),
    );

  return btsTicketNumber || null;
}

/* ------------------------------------------------------------------------- *
 * Inbound webhook: mirror TicketDesk replies back into the portal ticket.
 *
 * TicketDesk posts a "new reply" event to POST /api/webhooks/ticketdesk every
 * time a message is added to a conversation.  We append the agent's reply to
 * the matching portal ticket (matched by the BTS ticket number that was stored
 * in the chat session's `externalId` field and echoed back in the webhook
 * payload, or found in the original message body) so the member sees the
 * response without leaving the portal.
 *
 * The exact payload shape from TicketDesk is not contractually fixed, so the
 * parser below is intentionally tolerant of several common field layouts.
 * ------------------------------------------------------------------------- */

/** Returns true when a TICKETDESK_WEBHOOK_SECRET is configured. */
export function isWebhookConfigured(): boolean {
  return !!getWebhookSecret();
}

/**
 * Verifies an inbound TicketDesk webhook signature.
 *
 * Computes HMAC-SHA256(rawBody) keyed by TICKETDESK_WEBHOOK_SECRET and
 * compares it timing-safely against the signature from the
 * `X-TicketDesk-Signature` header (hex digest). Returns true when no secret is
 * configured so callers can decide their own fail-open / fail-closed policy.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
): boolean {
  const secret = getWebhookSecret();
  if (!secret) return true;
  if (!signature) return false;

  try {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    const provided = signature.startsWith("sha256=")
      ? signature.slice("sha256=".length)
      : signature;
    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(provided, "hex");
    if (expectedBuf.length !== providedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

/** A parsed inbound reply, normalised across TicketDesk payload shapes. */
export interface TicketDeskInboundReply {
  /** BTS portal ticket number the conversation references (e.g. "BTS-123456"). */
  btsTicketNumber: string;
  /** The reply text to append to the portal ticket thread. */
  body: string;
  /**
   * TicketDesk's own id for this reply/message, used for idempotency.  Null
   * when the payload carries no id (the caller then cannot dedupe this delivery).
   */
  externalId: string | null;
  /**
   * Lower-cased author/sender type as reported by TicketDesk
   * (e.g. "agent", "staff", "admin", "operator", "contact", "customer").
   * Null when the payload doesn't identify the author.
   */
  authorType: string | null;
  /** Lower-cased event type when present (e.g. "conversation.reply.created"). */
  eventType: string | null;
}

function firstString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c;
    if (typeof c === "number") return String(c);
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Extract a BTS ticket number from arbitrary text.
 * Matches patterns like "BTS-123456" anywhere in the string.
 */
function extractBtsTicketNumber(text: string): string {
  const match = /BTS-\d+/i.exec(text);
  return match ? match[0].toUpperCase() : "";
}

/**
 * Author types that represent the member (contact) side of the conversation.
 * Replies from these authors are echoes of the member's own messages — they
 * are already in the portal thread, so we must NOT mirror them back.
 */
const CONTACT_AUTHOR_TYPES = new Set([
  "contact",
  "customer",
  "member",
  "user",
  "client",
  "end_user",
  "enduser",
  "lead",
]);

/** True when the reply originated from the member side, not a support agent. */
export function isMemberAuthor(authorType: string | null): boolean {
  return !!authorType && CONTACT_AUTHOR_TYPES.has(authorType);
}

/**
 * Parses an inbound TicketDesk webhook body into a normalised reply.
 *
 * Returns null when the payload does not carry both a BTS ticket reference and
 * a non-empty reply body (e.g. a non-reply event, or a malformed payload) —
 * the caller should ACK such deliveries with 200 and ignore them.
 *
 * Cross-reference lookup order:
 *   1. Explicit reference fields (conversation.externalId, thread.externalId,
 *      payload.reference, etc.)
 *   2. BTS-XXXXXX pattern extracted from the thread/conversation subject or
 *      the message body itself (present because we embed it in the first
 *      message on outbound delivery).
 */
export function parseInboundReply(
  payload: Record<string, unknown>,
): TicketDeskInboundReply | null {
  const data = asRecord(payload.data);
  const reply = asRecord(payload.reply ?? data.reply);
  const message = asRecord(payload.message ?? data.message);
  const comment = asRecord(payload.comment ?? data.comment);
  const conversation = asRecord(
    payload.conversation ?? data.conversation ?? reply.conversation,
  );
  const thread = asRecord(
    payload.thread ?? data.thread ?? reply.thread ?? message.thread,
  );

  const btsTicketNumber =
    firstString(
      payload.reference,
      data.reference,
      conversation.reference,
      thread.reference,
      reply.reference,
      message.reference,
      payload.btsTicketNumber,
      data.btsTicketNumber,
      conversation.externalId,
      thread.externalId,
      payload.externalId,
      data.externalId,
    ).trim() ||
    extractBtsTicketNumber(
      firstString(
        conversation.subject,
        thread.subject,
        reply.body,
        message.body,
        payload.body,
        data.body,
        reply.text,
        message.text,
        payload.text,
        data.text,
      ),
    );

  const body = firstString(
    reply.body,
    message.body,
    comment.body,
    payload.body,
    data.body,
    reply.text,
    message.text,
    payload.text,
    data.text,
    reply.bodyText,
    message.bodyText,
    payload.bodyText,
    data.bodyText,
  ).trim();

  if (!btsTicketNumber || !body) return null;

  const externalIdRaw = firstString(
    reply.id,
    message.id,
    comment.id,
    payload.replyId,
    data.replyId,
    payload.messageId,
    data.messageId,
    payload.id,
    data.id,
  ).trim();

  const authorRecord = asRecord(
    reply.author ??
      message.author ??
      comment.author ??
      payload.author ??
      data.author,
  );
  const authorTypeRaw = firstString(
    authorRecord.type,
    authorRecord.role,
    reply.authorType,
    message.authorType,
    reply.senderType,
    message.senderType,
    payload.authorType,
    data.authorType,
    payload.senderType,
    data.senderType,
  ).trim();

  const eventTypeRaw = firstString(
    payload.event,
    payload.type,
    data.event,
    data.type,
  ).trim();

  return {
    btsTicketNumber,
    body,
    externalId: externalIdRaw || null,
    authorType: authorTypeRaw ? authorTypeRaw.toLowerCase() : null,
    eventType: eventTypeRaw ? eventTypeRaw.toLowerCase() : null,
  };
}
