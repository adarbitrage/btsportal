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
 * Set this secret in the Replit environment:
 *   TICKETDESK_API_KEY=<your-api-key>
 *
 * Without this key the TicketDesk delivery path is skipped (portal ticket
 * creation still succeeds; TicketDesk sync is simply no-op).
 */
export const TICKETDESK_API_KEY_ENV = "TICKETDESK_API_KEY";

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
