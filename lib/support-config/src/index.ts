/**
 * Single source of truth for the live-chat support destination (TicketDesk).
 *
 * This URL is consumed in two independent places that must never disagree:
 *   - the portal embed (`artifacts/portal/src/config/support.ts` →
 *     `LiveChatLauncher.tsx`), which is the URL real members load in the
 *     in-page iframe (and fall back to opening in a new tab), and
 *   - the backend health probe
 *     (`artifacts/api-server/src/lib/live-chat-embed-probe.ts`), which
 *     periodically fetches the embed URL, inspects its framing headers, and
 *     pages on-call / surfaces on System Health when the embed would break.
 *
 * Previously each side carried its own default literal. If the support desk
 * moved and only one literal was updated, the System Health page would report
 * on a different URL than the one members actually see — masking a real
 * outage. Keeping the default here, with a test pinning both consumers to it,
 * makes that drift impossible: both sides import the exact same constant.
 *
 * Each consumer still has its own env override (`VITE_TICKETDESK_URL` for the
 * Vite-built portal, `LIVE_CHAT_EMBED_PROBE_URL` for the Node backend) because
 * those resolve in different runtimes; only the shared *default* lives here.
 */
export const DEFAULT_TICKETDESK_URL = "https://tickets.buildtestscale.com/";
