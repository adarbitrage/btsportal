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

import {
  DEFAULT_TICKETDESK_WIDGET_API_URL,
  DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID,
} from "@workspace/support-config";

const TICKETDESK_API_URL =
  process.env.TICKETDESK_API_URL || DEFAULT_TICKETDESK_WIDGET_API_URL;

const TICKETDESK_WORKSPACE_ID =
  process.env.TICKETDESK_WORKSPACE_ID || DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID;

const TICKETDESK_API_KEY = process.env.TICKETDESK_API_KEY || "";

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
