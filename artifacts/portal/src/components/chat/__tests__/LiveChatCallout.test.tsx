// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  LiveChatCallout,
  LIVE_CHAT_CALLOUT_DISMISSED_KEY,
  isLiveChatCalloutDismissed,
} from "../LiveChatCallout";

describe("LiveChatCallout", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders the callout copy, arrow, and dismiss control", () => {
    render(<LiveChatCallout />);
    expect(screen.getByTestId("live-chat-callout")).toBeInTheDocument();
    expect(screen.getByText("Have questions?")).toBeInTheDocument();
    expect(screen.getByText("Chat with a live team member now.")).toBeInTheDocument();
    expect(screen.getByTestId("live-chat-callout-arrow")).toBeInTheDocument();
    expect(screen.getByTestId("live-chat-callout-dismiss")).toBeInTheDocument();
  });

  it("keeps the wrapper pointer-events-none so the chat bubble stays clickable", () => {
    render(<LiveChatCallout />);
    expect(screen.getByTestId("live-chat-callout").className).toContain("pointer-events-none");
  });

  it("hugs the pinned TicketDesk bubble (bottom 96px + 56px height + 8px gap)", () => {
    // src/lib/ticketdesk-bubble-pin.ts pins the shadow-DOM bubble at
    // bottom: 96px; it is 56px tall (top edge 152px) at right: 20px with its
    // center 48px from the right edge. The callout wrapper anchors at
    // right-5 (20px) + bottom-40 (160px) so the arrow's bottom edge sits 8px
    // above the bubble, and the arrow's mr-3.5 (14px) + w-7 (28px) centers
    // it on the bubble column (20 + 14 + 14 = 48px).
    render(<LiveChatCallout />);
    const callout = screen.getByTestId("live-chat-callout");
    expect(callout.className).toContain("bottom-40");
    expect(callout.className).toContain("right-5");
    const arrow = screen.getByTestId("live-chat-callout-arrow");
    expect(arrow.getAttribute("class")).toContain("mr-3.5");
    expect(arrow.getAttribute("class")).toContain("w-7");
    // mt-7 keeps the pill's bottom edge at 216px so it clears the raised
    // BackToTopButton (top edge 216px).
    expect(arrow.getAttribute("class")).toContain("mt-7");
  });

  it("keeps the same offsets when the FE call bar is visible (bubble stays pinned at 96px)", () => {
    render(<LiveChatCallout raised />);
    const callout = screen.getByTestId("live-chat-callout");
    expect(callout.className).toContain("bottom-40");
    expect(callout.className).toContain("right-5");
  });

  it("dismisses on × click and persists the dismissal to localStorage", () => {
    render(<LiveChatCallout />);
    fireEvent.click(screen.getByTestId("live-chat-callout-dismiss"));
    expect(screen.queryByTestId("live-chat-callout")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(LIVE_CHAT_CALLOUT_DISMISSED_KEY)).toBe("1");
    expect(isLiveChatCalloutDismissed()).toBe(true);
  });

  it("does not render at all when the dismissal is already persisted", () => {
    window.localStorage.setItem(LIVE_CHAT_CALLOUT_DISMISSED_KEY, "1");
    render(<LiveChatCallout />);
    expect(screen.queryByTestId("live-chat-callout")).not.toBeInTheDocument();
  });
});
