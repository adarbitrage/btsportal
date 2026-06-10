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
export const DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID =
  "69a3830f-e36b-4c87-91fd-0c9e26b27278";

/** TicketDesk API base URL passed to the widget script via `data-api`. */
export const DEFAULT_TICKETDESK_WIDGET_API_URL =
  "https://tickets.buildtestscale.com/api";
