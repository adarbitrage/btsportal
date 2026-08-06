// @vitest-environment jsdom
/**
 * The TicketDesk widget renders its chat bubble inside an OPEN shadow root
 * (page CSS can't reach it), so the 96px pinning must be injected as a
 * <style> element into the shadow root. These tests lock the injection
 * mechanics and the geometry contract shared with LiveChatCallout and
 * BackToTopButton.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  TICKETDESK_BUBBLE_BOTTOM_PX,
  TICKETDESK_BUBBLE_PIN_CSS,
  TICKETDESK_BUBBLE_PIN_STYLE_ID,
  TICKETDESK_HOST_Z_INDEX,
  pinTicketDeskBubble,
  pinTicketDeskHost,
} from "../ticketdesk-bubble-pin";

function makeHost({ zIndex = TICKETDESK_HOST_Z_INDEX }: { zIndex?: string } = {}) {
  const host = document.createElement("div");
  host.style.zIndex = zIndex;
  const root = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);
  return { host, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ticketdesk-bubble-pin", () => {
  it("pins the bubble at 96px — the offset the callout/back-to-top geometry assumes", () => {
    expect(TICKETDESK_BUBBLE_BOTTOM_PX).toBe(96);
    expect(TICKETDESK_BUBBLE_PIN_CSS).toContain(".bubble { bottom: 96px !important; }");
  });

  it("moves the opened chat panel up in lockstep so the pinned bubble never covers it", () => {
    // Stock: bubble top edge 76px, panel bottom 88px (12px gap). Pinned
    // bubble top edge = 96 + 56 = 152px → panel bottom 164px, with the
    // stock 32px of viewport breathing room preserved in max-height.
    expect(TICKETDESK_BUBBLE_PIN_CSS).toContain(".panel { bottom: 164px !important;");
    expect(TICKETDESK_BUBBLE_PIN_CSS).toContain("max-height: calc(100vh - 196px) !important;");
  });

  it("injects the style into the widget host's open shadow root (idempotently)", () => {
    const { host, root } = makeHost();
    expect(pinTicketDeskHost(host)).toBe(true);
    const style = root.querySelector(`#${TICKETDESK_BUBBLE_PIN_STYLE_ID}`);
    expect(style?.textContent).toBe(TICKETDESK_BUBBLE_PIN_CSS);
    // Second call is a no-op, not a duplicate.
    expect(pinTicketDeskHost(host)).toBe(true);
    expect(root.querySelectorAll(`#${TICKETDESK_BUBBLE_PIN_STYLE_ID}`)).toHaveLength(1);
  });

  it("ignores unrelated elements and shadow hosts", () => {
    const plain = document.createElement("div");
    document.body.appendChild(plain);
    expect(pinTicketDeskHost(plain)).toBe(false);

    const { host, root } = makeHost({ zIndex: "50" });
    expect(pinTicketDeskHost(host)).toBe(false);
    expect(root.querySelector("style")).toBeNull();
  });

  it("pins a host that is already in the DOM at call time", () => {
    const { root } = makeHost();
    const stop = pinTicketDeskBubble();
    expect(root.querySelector(`#${TICKETDESK_BUBBLE_PIN_STYLE_ID}`)).not.toBeNull();
    stop();
  });

  it("pins a host that appears after the async widget script loads", async () => {
    const stop = pinTicketDeskBubble();
    const { root } = makeHost();
    // MutationObserver callbacks are microtask-scheduled.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector(`#${TICKETDESK_BUBBLE_PIN_STYLE_ID}`)).not.toBeNull();
    stop();
  });
});
