/**
 * Pins the TicketDesk live-chat bubble at a fixed vertical offset so it sits
 * above the AI chat launcher (bottom-6 + height ≈ 96px) instead of at the
 * widget's stock `bottom: 20px`.
 *
 * Why JS and not CSS: the TicketDesk widget (widget.js) renders inside an
 * OPEN shadow root attached to a full-width fixed host `<div>` it appends to
 * `document.body` (inline `z-index: 2147483646`). Page-level CSS can never
 * reach elements inside a shadow root, so a stylesheet rule (the old
 * `.woot-widget-bubble { bottom: 96px !important }` in index.css) silently
 * did nothing. The only way to restyle the bubble is to inject a `<style>`
 * element INTO the shadow root — legal because the root is open.
 *
 * Geometry contract (keep in lockstep — see LiveChatCallout.tsx and
 * BackToTopButton.tsx):
 *   - bubble: right 20px (widget stock .pos-right), 56px wide/tall,
 *     bottom pinned here at 96px → occupies 96–152px from the bottom,
 *     horizontal center 48px from the right viewport edge.
 *   - LiveChatCallout's arrow centers on that 48px column just above 152px.
 *   - BackToTopButton stays left of the 20–76px bubble column.
 *
 * The widget script loads async, so we scan once and then watch body for the
 * host to appear. The injected style is appended to the shadow root itself
 * (not the widget's re-rendered wrapper), so it survives the widget's
 * innerHTML re-renders.
 */

export const TICKETDESK_BUBBLE_BOTTOM_PX = 96;

export const TICKETDESK_BUBBLE_PIN_STYLE_ID = "bts-ticketdesk-bubble-pin";

/** The widget host div's inline z-index — our fingerprint for finding it. */
export const TICKETDESK_HOST_Z_INDEX = "2147483646";

/**
 * The opened chat panel must move up in lockstep with the bubble. Widget
 * stock geometry: bubble bottom 20px (top edge 76px), panel bottom 88px →
 * a 12px gap above the bubble; panel max-height calc(100vh - 120px) →
 * 32px of breathing room above the panel. Preserve both with the pinned
 * bubble: top edge 152px → panel bottom 164px, max-height 100vh - 196px.
 */
export const TICKETDESK_PANEL_BOTTOM_PX = TICKETDESK_BUBBLE_BOTTOM_PX + 56 + 12;

export const TICKETDESK_BUBBLE_PIN_CSS = [
  `.bubble { bottom: ${TICKETDESK_BUBBLE_BOTTOM_PX}px !important; }`,
  `.panel { bottom: ${TICKETDESK_PANEL_BOTTOM_PX}px !important; max-height: calc(100vh - ${TICKETDESK_PANEL_BOTTOM_PX + 32}px) !important; }`,
].join("\n");

/**
 * Injects the pin style into `host`'s open shadow root if it looks like the
 * TicketDesk widget host. Returns true once the style is present.
 */
export function pinTicketDeskHost(host: Node): boolean {
  if (!(host instanceof HTMLElement)) return false;
  const root = host.shadowRoot;
  if (!root) return false;
  // Identify the TicketDesk host by its distinctive inline z-index rather
  // than class names (it has none) or shadow content (rendered async).
  if (host.style.zIndex !== TICKETDESK_HOST_Z_INDEX) return false;
  if (root.querySelector(`#${TICKETDESK_BUBBLE_PIN_STYLE_ID}`)) return true;
  const style = document.createElement("style");
  style.id = TICKETDESK_BUBBLE_PIN_STYLE_ID;
  style.textContent = TICKETDESK_BUBBLE_PIN_CSS;
  root.appendChild(style);
  return true;
}

/**
 * Pins the TicketDesk bubble as soon as the widget host appears in the DOM.
 * Idempotent; returns a cleanup function that stops watching.
 */
export function pinTicketDeskBubble(): () => void {
  const scan = () => Array.from(document.body.children).some(pinTicketDeskHost);
  if (scan()) return () => {};
  const observer = new MutationObserver(() => {
    if (scan()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true });
  return () => observer.disconnect();
}
