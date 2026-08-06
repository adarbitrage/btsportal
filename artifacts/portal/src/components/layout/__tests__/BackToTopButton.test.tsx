/**
 * Rendered checks for the portal-wide back-to-top button:
 * - appears only after a meaningful window scroll
 * - clicking scrolls the window to the top (reduced-motion aware)
 * - its fixed bottom offset always clears the TicketDesk chat launcher
 *   (56px circle at bottom: 20px → top edge at 76px from the viewport
 *   bottom) in BOTH the normal and raised (FE call bar visible) states.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BackToTopButton, SCROLL_THRESHOLD_PX } from "../BackToTopButton";
import { LiveChatCallout } from "@/components/chat/LiveChatCallout";

// src/lib/ticketdesk-bubble-pin.ts injects `bottom: 96px !important` into the
// widget's shadow root (above the AI launcher); the bubble itself is
// 56px tall, so the bottom-right widget column tops out at 152px.
const CHAT_LAUNCHER_TOP_PX = 96 + 56;

// Tailwind bottom-* utilities used by the component → px, so the test fails
// loudly if someone lowers the button back into the launcher's box.
const TAILWIND_BOTTOM_PX: Record<string, number> = {
  "bottom-40": 160,
  "sm:bottom-40": 160,
  "bottom-44": 176,
};

function bottomOffsetsPx(el: HTMLElement): number[] {
  const classes = el.className.split(/\s+/).filter((c) => c.includes("bottom-"));
  expect(classes.length, "expected fixed bottom-* classes").toBeGreaterThan(0);
  return classes.map((c) => {
    const px = TAILWIND_BOTTOM_PX[c];
    expect(px, `unknown bottom class ${c} — add it to the map`).toBeDefined();
    return px;
  });
}

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  fireEvent.scroll(window);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BackToTopButton", () => {
  it("is hidden at the top and appears after scrolling past the threshold", () => {
    render(<BackToTopButton />);
    const btn = screen.getByTestId("back-to-top");
    expect(btn.className).toContain("opacity-0");
    setScrollY(SCROLL_THRESHOLD_PX + 1);
    expect(btn.className).toContain("opacity-100");
    setScrollY(0);
    expect(btn.className).toContain("opacity-0");
  });

  it("scrolls the window to the top on click (smooth by default, instant under reduced motion)", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal("matchMedia", matchMedia);

    render(<BackToTopButton />);
    setScrollY(SCROLL_THRESHOLD_PX + 1);
    fireEvent.click(screen.getByTestId("back-to-top"));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

    matchMedia.mockReturnValue({ matches: true });
    fireEvent.click(screen.getByTestId("back-to-top"));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "instant" });
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    vi.unstubAllGlobals();
  });

  it("never overlaps the chat launcher: every bottom offset clears the launcher's top edge", () => {
    for (const raised of [false, true]) {
      const { unmount } = render(<BackToTopButton raised={raised} />);
      const btn = screen.getByTestId("back-to-top");
      expect(btn.className).toContain("fixed");
      for (const px of bottomOffsetsPx(btn)) {
        expect(
          px,
          `raised=${raised}: button bottom ${px}px must sit above the chat launcher (top ${CHAT_LAUNCHER_TOP_PX}px)`,
        ).toBeGreaterThanOrEqual(CHAT_LAUNCHER_TOP_PX + 8);
      }
      unmount();
    }
  });

  it("stays clear of the TicketDesk bubble column and the LiveChatCallout arrow", () => {
    // The callout's arrow must hover directly over the bubble (right
    // 20–76px), so the button relies on HORIZONTAL separation: right-24
    // (96px) keeps the whole 40px-wide button (96–136px) left of the bubble
    // column and the callout arrow (right 34–62px). Regression-test both
    // rendered simultaneously.
    window.localStorage.removeItem("bts:live-chat-callout-dismissed");
    render(
      <>
        <BackToTopButton raised />
        <LiveChatCallout raised />
      </>,
    );
    const btn = screen.getByTestId("back-to-top");
    const callout = screen.getByTestId("live-chat-callout");

    const BUBBLE_COLUMN_MAX_PX = 76; // bubble right edge 20px + 56px width
    expect(btn.className).toContain("right-24"); // 96px
    expect(96).toBeGreaterThanOrEqual(BUBBLE_COLUMN_MAX_PX + 8);

    // The button must never regress back into the bubble column.
    expect(btn.className).not.toMatch(/(^|\s)(sm:)?right-(3|5|16)(\s|$)/);

    // The callout wrapper anchors AT the bubble column (right-5 = 20px) so
    // its arrow can center on the bubble.
    expect(callout.className).toContain("right-5");

    // The callout's pill starts at 216px from the bottom (bottom-40 = 160px
    // + 28px arrow + mt-7 = 28px gap), exactly the raised button's top edge
    // (bottom-44 = 176px + 40px height), so they never overlap vertically.
    for (const px of bottomOffsetsPx(btn)) {
      expect(px + 40).toBeLessThanOrEqual(216);
    }
  });

  it("has an accessible label", () => {
    render(<BackToTopButton />);
    setScrollY(SCROLL_THRESHOLD_PX + 1);
    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();
  });
});
