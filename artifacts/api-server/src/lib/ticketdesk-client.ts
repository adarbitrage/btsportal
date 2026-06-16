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

const TICKETDESK_API_URL =
  process.env.TICKETDESK_API_URL || DEFAULT_TICKETDESK_WIDGET_API_URL;

const TICKETDESK_WORKSPACE_ID =
  process.env.TICKETDESK_WORKSPACE_ID || DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID;

/**
 * Origin header sent with every chat API request. Must match an entry in the
 * TicketDesk workspace's allowed-origins list (Chat Config settings).
 *
 * Default: https://portal.buildtestscale.com
 * Override via: TICKETDESK_CHAT_ORIGIN=<url>
 */
const TICKETDESK_CHAT_ORIGIN =
  process.env.TICKETDESK_CHAT_ORIGIN ||
  process.env.PORTAL_URL ||
  "https://portal.buildtestscale.com";

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
  const sessionUrl = `${TICKETDESK_API_URL}/chat/session`;
  const portalTicketUrl = `${TICKETDESK_CHAT_ORIGIN}/support/tickets/${input.btsTicketNumber}`;

  const sessionPayload = {
    workspaceId: TICKETDESK_WORKSPACE_ID,
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
      Origin: TICKETDESK_CHAT_ORIGIN,
    },
    body: JSON.stringify(sessionPayload),
  });

  if (!sessionResponse.ok) {
    const errorText = await sessionResponse.text().catch(() => "(no body)");
    if (sessionResponse.status === 403 && errorText.includes("Origin not allowed")) {
      throw new Error(
        `TicketDesk rejected origin "${TICKETDESK_CHAT_ORIGIN}" (403 Origin not allowed). ` +
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

  const messageUrl = `${TICKETDESK_API_URL}/chat/messages`;

  const messageResponse = await fetch(messageUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
      Origin: TICKETDESK_CHAT_ORIGIN,
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
