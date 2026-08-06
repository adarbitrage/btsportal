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

// The portal's index.css pushes the TicketDesk/Chatwoot bubble to
// `bottom: 96px !important` (above the AI launcher); the bubble itself is
// ~56px tall, so the bottom-right widget stack tops out at ~152px.
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

  it("is never covered by the LiveChatCallout when both are raised by the FE call bar", () => {
    // The callout (z-50) shares the raised vertical band with the button
    // (z-40); usability relies on HORIZONTAL separation: the callout is
    // anchored at right-16 (64px), fully left of the button column
    // (40px wide at right-3 = 12px / sm:right-5 = 20px → right edge span
    // ends at 60px). Regression-test both rendered simultaneously.
    window.localStorage.removeItem("bts:live-chat-callout-dismissed");
    render(
      <>
        <BackToTopButton raised />
        <LiveChatCallout raised />
      </>,
    );
    const btn = screen.getByTestId("back-to-top");
    const callout = screen.getByTestId("live-chat-callout");

    // Button's furthest extent from the right edge, per breakpoint.
    const BUTTON_WIDTH_PX = 40; // h-10 w-10
    const buttonRights = btn.className
      .split(/\s+/)
      .filter((c) => /^(sm:)?right-/.test(c))
      .map((c) => ({ "right-3": 12, "sm:right-5": 20 }[c]));
    expect(buttonRights).toEqual([12, 20]);
    const buttonMaxExtent = Math.max(...(buttonRights as number[])) + BUTTON_WIDTH_PX;

    // Callout wrapper must start left of the button column with a gap.
    expect(callout.className).toContain("right-16"); // 64px
    expect(64).toBeGreaterThanOrEqual(buttonMaxExtent + 4);

    // And the callout must never regress back into the button column.
    expect(callout.className).not.toMatch(/(^|\s)(sm:)?right-(3|5)(\s|$)/);
  });

  it("has an accessible label", () => {
    render(<BackToTopButton />);
    setScrollY(SCROLL_THRESHOLD_PX + 1);
    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();
  });
});
