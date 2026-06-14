/**
 * TicketDesk HTTP client — programmatic conversation creation.
 *
 * ## Discovery
 * TicketDesk (tickets.buildtestscale.com) exposes a REST API at
 * `https://tickets.buildtestscale.com/api`.  The live-chat widget uses the
 * same base URL with workspace-scoped paths of the form:
 *
 *   POST /api/v1/workspaces/{workspaceId}/conversations
 *
 * Authentication is via a Bearer token in the `Authorization` header, issued
 * from the TicketDesk workspace settings ("API Keys" or "Integrations" page).
 *
 * ## Required configuration
 * Set the following environment variable before deploying:
 *
 *   TICKETDESK_API_KEY=<api-key-from-ticketdesk-workspace-settings>
 *
 * Optional overrides (defaults from @workspace/support-config):
 *   TICKETDESK_API_URL   — override the API base (default: https://tickets.buildtestscale.com/api)
 *   TICKETDESK_WORKSPACE_ID — override the workspace UUID
 *
 * Without TICKETDESK_API_KEY the client's `isConfigured()` returns false and
 * the queue skips delivery silently (the member's ticket is still created
 * locally — no regression).
 *
 * ## Payload contract (POST .../conversations)
 * {
 *   contact: { email: string; name: string }   // drives getOrCreateContact
 *   subject: string
 *   body: string
 *   reference: string   // BTS ticket number for cross-reference
 * }
 *
 * The server responds with 201 + { id, conversationNumber } on success.
 * Any non-2xx response is thrown so the queue can retry.
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

const TICKETDESK_API_KEY = process.env.TICKETDESK_API_KEY || "";

// Shared secret used to verify inbound TicketDesk webhook deliveries.
// Read lazily inside verifyWebhookSignature/isWebhookConfigured so tests can
// set process.env.TICKETDESK_WEBHOOK_SECRET before importing the route.
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
}

export interface TicketDeskConversationResult {
  /** TicketDesk internal conversation ID. */
  id: string;
  /** Human-readable conversation number assigned by TicketDesk. */
  conversationNumber?: string | number;
}

/**
 * Returns true when TICKETDESK_API_KEY is set.
 * The queue calls this before attempting delivery so missing config is a
 * silent no-op rather than a noisy error stream.
 */
export function isConfigured(): boolean {
  return !!TICKETDESK_API_KEY;
}

/**
 * Creates a new conversation in TicketDesk under the member's email contact.
 *
 * Throws on any non-2xx response so the BullMQ worker can retry.
 */
export async function createConversation(
  input: TicketDeskConversationInput,
): Promise<TicketDeskConversationResult> {
  if (!TICKETDESK_API_KEY) {
    throw new Error("TICKETDESK_API_KEY is not configured");
  }

  const url = `${TICKETDESK_API_URL}/v1/workspaces/${TICKETDESK_WORKSPACE_ID}/conversations`;

  const payload = {
    contact: {
      email: input.contactEmail,
      name: input.contactName,
    },
    subject: input.subject,
    body: input.body,
    reference: input.btsTicketNumber,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TICKETDESK_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "(no body)");
    throw new Error(
      `TicketDesk API POST ${url} failed (${response.status}): ${errorText}`,
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  return {
    id: String(data.id ?? ""),
    conversationNumber: data.conversationNumber as string | number | undefined,
  };
}

/* ------------------------------------------------------------------------- *
 * Inbound webhook: mirror TicketDesk replies back into the portal ticket.
 *
 * TicketDesk posts a "new reply" event to POST /api/webhooks/ticketdesk every
 * time a message is added to a conversation. We append the agent's reply to the
 * matching portal ticket (matched by the BTS ticket number stored in the
 * conversation's `reference` field on outbound delivery) so the member sees the
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
 * Computes HMAC-SHA256(rawBody) keyed by TICKETDESK_WEBHOOK_SECRET and compares
 * it timing-safely against the signature from the `X-TicketDesk-Signature`
 * header (hex digest). Returns true when no secret is configured so callers can
 * decide their own fail-open / fail-closed policy by environment.
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
    // Normalise a possible "sha256=" prefix some senders prepend.
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
   * TicketDesk's own id for this reply/message, used for idempotency. Null when
   * the payload carries no id (the caller then cannot dedupe this delivery).
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
 * Author types that represent the member (contact) side of the conversation.
 * Replies from these authors are echoes of the member's own messages — they are
 * already in the portal thread, so we must NOT mirror them back (that would
 * duplicate the member's message and could create a feedback loop).
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
 * a non-empty reply body (e.g. a non-reply event, or a malformed payload) — the
 * caller should ACK such deliveries with 200 and ignore them.
 */
export function parseInboundReply(
  payload: Record<string, unknown>,
): TicketDeskInboundReply | null {
  // The meaningful fields can live at the top level, under `data`, under
  // `reply`/`message`/`comment`, and the conversation under `conversation`.
  const data = asRecord(payload.data);
  const reply = asRecord(payload.reply ?? data.reply);
  const message = asRecord(payload.message ?? data.message);
  const comment = asRecord(payload.comment ?? data.comment);
  const conversation = asRecord(
    payload.conversation ?? data.conversation ?? reply.conversation,
  );

  const btsTicketNumber = firstString(
    payload.reference,
    data.reference,
    conversation.reference,
    reply.reference,
    message.reference,
    payload.btsTicketNumber,
    data.btsTicketNumber,
  ).trim();

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
    reply.author ?? message.author ?? comment.author ?? payload.author ?? data.author,
  );
  const authorTypeRaw = firstString(
    authorRecord.type,
    authorRecord.role,
    reply.authorType,
    message.authorType,
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
