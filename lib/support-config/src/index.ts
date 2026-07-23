/**
 * Single source of truth for the live-chat support destination (TicketDesk).
 *
 * These constants are consumed in two independent places that must never
 * disagree:
 *   - the portal embed (`artifacts/portal/src/config/support.ts` →
 *     `LiveChatLauncher.tsx`), which injects the widget script so the
 *     configured customer-facing chat widget renders on the page, and
 *   - the backend health probe
 *     (`artifacts/api-server/src/lib/live-chat-embed-probe.ts`), which
 *     periodically checks that the widget script URL is accessible and pages
 *     on-call / surfaces on System Health when it isn't.
 *
 * Previously each side carried its own default literal. If the support desk
 * moved and only one literal was updated, the System Health page would report
 * on a different URL than the one members actually load — masking a real
 * outage. Keeping the defaults here, with a test pinning both consumers to
 * them, makes that drift impossible.
 *
 * Each consumer still has its own env override (`VITE_TICKETDESK_*` for the
 * Vite-built portal, `LIVE_CHAT_EMBED_PROBE_URL` for the Node backend) because
 * those resolve in different runtimes; only the shared *defaults* live here.
 */

export * from "./upload-limits";

/**
 * Customer-facing toll-free phone number for AI voice support.
 *
 * Defaults to empty string so nothing is displayed until the real number is
 * provisioned in Retell and configured via the `VITE_SUPPORT_PHONE_NUMBER`
 * env override in the portal.  The portal hides the call option entirely when
 * this resolves to an empty string.
 */
export const DEFAULT_SUPPORT_PHONE_NUMBER = "";

/** Root URL of the TicketDesk installation. */
export const DEFAULT_TICKETDESK_URL = "https://tickets.buildtestscale.com/";

/** URL of the TicketDesk JavaScript widget bundle. */
export const DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL =
  "https://tickets.buildtestscale.com/widget.js";

/** TicketDesk workspace (account) ID for the customer-facing chat widget. */
export const DEFAULT_TICKETDESK_WORKSPACE_ID =
  "69a3830f-e36b-4c87-91fd-0c9e26b27278";

/**
 * @deprecated Use DEFAULT_TICKETDESK_WORKSPACE_ID — kept for backward
 * compatibility with the widget-embed consumers that reference this name.
 */
export const DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID =
  DEFAULT_TICKETDESK_WORKSPACE_ID;

/** TicketDesk API base URL passed to the widget script via `data-api`. */
export const DEFAULT_TICKETDESK_WIDGET_API_URL =
  "https://tickets.buildtestscale.com/api";

/**
 * The environment variable name that the backend reads for the TicketDesk
 * API key used to create conversations programmatically.
 *
 * @deprecated The chat session API (POST /api/chat/session) does not require
 * an API key.  This constant is kept for backward compatibility with any code
 * that references it, but the key itself is no longer read or required.
 */
export const TICKETDESK_API_KEY_ENV = "TICKETDESK_API_KEY";

/**
 * The environment variable name that sets the HTTP `Origin` header sent with
 * every TicketDesk chat API request.
 *
 * TicketDesk validates the Origin header against the workspace's configured
 * allowed-origin list (set in TicketDesk workspace → Settings → Chat Config).
 * The portal domain must appear in that list, or delivery will fail with
 * 403 "Origin not allowed".
 *
 * Default: https://portal.buildtestscale.com (or PORTAL_URL if set)
 *
 * ## One-time account-owner setup
 * 1. Log in to TicketDesk as a workspace admin.
 * 2. Go to Settings → Chat Config.
 * 3. Add the value of this env var (the portal domain) to the allowed-origins
 *    list.  Delivery will succeed from that point on with no code changes.
 */
export const TICKETDESK_CHAT_ORIGIN_ENV = "TICKETDESK_CHAT_ORIGIN";

/**
 * The environment variable name that the backend reads for the shared secret
 * used to verify inbound TicketDesk webhook deliveries (the "new reply" events
 * that mirror a support agent's reply back into the member's portal ticket).
 *
 * Set this secret in the Replit environment and configure the same value as
 * the signing secret in the TicketDesk workspace webhook settings:
 *   TICKETDESK_WEBHOOK_SECRET=<shared-secret>
 *
 * The inbound webhook endpoint (POST /api/webhooks/ticketdesk) computes an
 * HMAC-SHA256 of the raw request body keyed by this secret and compares it
 * (timing-safe) against the `X-TicketDesk-Signature` header. When the secret
 * is absent the endpoint fails open in non-production (so local/dev testing
 * works without configuration) but fails closed in production (returns 503)
 * so a missing secret can never silently accept unauthenticated replies.
 */
export const TICKETDESK_WEBHOOK_SECRET_ENV = "TICKETDESK_WEBHOOK_SECRET";

/**
 * Single source of truth for the support-ticket categories the backend can
 * emit on a ticket's `category` field.
 *
 * The ticket `category` column is free-form text in the database, so the
 * authoritative set of values lives here instead. Two independent consumers
 * must agree on this list:
 *   - the API server, which stamps the internal categories below onto tickets
 *     it auto-creates (the concierge and compliance intake forms), and
 *   - the admin portal, whose `CATEGORY_LABELS` map
 *     (`artifacts/portal/src/pages/admin/AdminTicketQueue.tsx`) must carry a
 *     curated, human-readable label for every value here — otherwise the queue
 *     silently falls back to slug-to-Title-Case for the missing one.
 *
 * A portal test pins `CATEGORY_LABELS` to this list, so adding a category here
 * without also adding a curated label fails CI. The member-facing subset
 * (everything except the internal categories) is additionally validated by the
 * OpenAPI `category` enum; a test cross-checks the generated client enum
 * against this list so a new member-facing enum value can never drift away
 * from the curated labels either.
 */

/**
 * Categories a member can pick when opening a ticket from the support form.
 * Mirrors the OpenAPI `CreateTicketBody`/`ListTicketsResponseItem` `category`
 * enum. Keep in lockstep with `openapi.yaml`.
 */
export const MEMBER_TICKET_CATEGORIES = [
  "billing",
  "technical",
  "training",
  "account",
  "other",
] as const;

/**
 * Categories the backend stamps onto tickets it auto-creates from internal
 * intake flows. These are never member-selectable and so are not part of the
 * OpenAPI create enum, but they are returned to admins on the ticket queue and
 * therefore still need curated labels.
 */
export const INTERNAL_TICKET_CATEGORIES = [
  "concierge_task",
  "compliance_review",
] as const;

/** The full set of ticket categories the backend can emit. */
export const TICKET_CATEGORIES = [
  ...MEMBER_TICKET_CATEGORIES,
  ...INTERNAL_TICKET_CATEGORIES,
] as const;

export type TicketCategorySlug = (typeof TICKET_CATEGORIES)[number];

/** Stable references for the internal categories the backend stamps directly. */
export const TICKET_CATEGORY = {
  conciergeTask: "concierge_task",
  complianceReview: "compliance_review",
} as const satisfies Record<string, (typeof INTERNAL_TICKET_CATEGORIES)[number]>;

/**
 * Single source of truth for the human-readable label of every ticket
 * category the backend can emit.
 *
 * The portal previously carried two independent copies of this map — a
 * member-facing one (`TICKET_CATEGORY_LABELS` in `support-topics.ts`) and an
 * admin one (`CATEGORY_LABELS` in `AdminTicketQueue.tsx`). They were identical
 * but could silently drift, so members and admins would see different labels
 * for the same ticket. Both now derive from this map.
 *
 * Keyed by `TicketCategorySlug`, so adding a new category to `TICKET_CATEGORIES`
 * without a curated label here fails the typecheck — never silently shipping a
 * slug-cased fallback for a real backend category.
 */
export const TICKET_CATEGORY_LABELS: Record<TicketCategorySlug, string> = {
  billing: "Billing",
  technical: "Technical",
  training: "Training",
  account: "Account",
  other: "Other",
  concierge_task: "Concierge Task",
  compliance_review: "Compliance Review",
};

/**
 * Render a ticket category as a human-readable label.
 *
 * Returns the curated label for known categories. For any unknown/future
 * value it falls back to turning snake_case into Title Case so the portal
 * never surfaces a raw enum slug. Empty/null/undefined input returns "".
 */
export function formatTicketCategory(category: string | null | undefined): string {
  if (!category) return "";
  const mapped = (TICKET_CATEGORY_LABELS as Record<string, string>)[category];
  if (mapped) return mapped;
  return category
    .split("_")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * Single source of truth for the support-ticket lifecycle statuses the backend
 * can emit on a ticket's `status` field.
 *
 * The ticket `status` column is free-form text in the database, so the
 * authoritative set lives here — the same pattern the category constants above
 * use. Member-facing submission views (Concierge, Compliance) and the admin
 * ticket queue all reason about these values, so centralizing the set and the
 * member-facing labels keeps those views from drifting apart.
 */
export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "awaiting_response",
  "resolved",
  "closed",
] as const;

export type TicketStatusSlug = (typeof TICKET_STATUSES)[number];

/**
 * Statuses where the ticket is still being worked — the member's submission is
 * "current"/active rather than finished. Used to split a member's submissions
 * into Current vs Past sections so that grouping can never disagree between the
 * Concierge and Compliance views.
 */
export const ACTIVE_TICKET_STATUSES = [
  "open",
  "in_progress",
  "awaiting_response",
] as const;

/** Statuses where the ticket is finished (the submission is complete). */
export const TERMINAL_TICKET_STATUSES = ["resolved", "closed"] as const;

/** True when a ticket is still being worked (open / in progress / awaiting reply). */
export function isActiveTicketStatus(status: string | null | undefined): boolean {
  return !!status && (ACTIVE_TICKET_STATUSES as readonly string[]).includes(status);
}

/**
 * The legacy manual status meaning "the team is waiting on the member". The
 * admin write path that set it has been retired — the member-facing
 * "reply needed" signal is now the inferred `awaitingMemberReply` flag on the
 * ticket (last message agent-authored AND not resolved), consumed via
 * {@link needsMemberReply}. The enum value is kept only so historical rows
 * still parse and group as active.
 */
export const AWAITING_MEMBER_STATUS = "awaiting_response";

/**
 * True when the member should be nudged to reply: the ticket is still active
 * and either the inferred `awaitingMemberReply` flag is set (the normal path —
 * last conversation message is agent-authored and the ticket isn't resolved)
 * or the ticket carries the legacy manual `awaiting_response` status from
 * before the flag existed. Rendered as a soft "New reply — response may be
 * needed" indicator, never an alarming "action required" gate.
 */
export function needsMemberReply(ticket: {
  status?: string | null;
  awaitingMemberReply?: boolean | null;
}): boolean {
  if (!isActiveTicketStatus(ticket.status)) return false;
  return !!ticket.awaitingMemberReply || ticket.status === AWAITING_MEMBER_STATUS;
}

/**
 * The soft member-facing indicator shown when {@link needsMemberReply} is
 * true. Shared by the Compliance and Concierge submission views so the copy
 * can never drift between them.
 */
export const MEMBER_REPLY_NEEDED_LABEL = "New reply — response may be needed";

/**
 * Member-facing status label for a submission badge. Members don't need the
 * admin's precise lifecycle vocabulary — they see whether their submission is
 * still queued ("Submitted — in queue"), actively being worked ("In progress —
 * the team is on it"), or finished ("Complete"). The reply-needed nudge is
 * conveyed by a separate soft indicator (see MEMBER_REPLY_NEEDED_LABEL), so
 * the badge itself never escalates.
 */
export const MEMBER_SUBMISSION_STATUS_LABELS: Record<TicketStatusSlug, string> = {
  open: "Submitted — in queue",
  in_progress: "In progress — the team is on it",
  awaiting_response: "In progress — the team is on it",
  resolved: "Complete",
  closed: "Complete",
};

/**
 * Render a ticket status as a member-facing submission label. Unknown/future
 * statuses fall back to the in-progress label so a member never sees a raw
 * enum slug.
 */
export function formatMemberSubmissionStatus(status: string | null | undefined): string {
  if (!status) return MEMBER_SUBMISSION_STATUS_LABELS.in_progress;
  return (
    (MEMBER_SUBMISSION_STATUS_LABELS as Record<string, string>)[status] ??
    MEMBER_SUBMISSION_STATUS_LABELS.in_progress
  );
}
