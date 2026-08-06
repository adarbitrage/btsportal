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

  it("clears the TicketDesk bubble by default (bubble bottom 96px + ~64px height + gap)", () => {
    // index.css pins .woot-widget-bubble at bottom: 96px !important; the
    // callout must sit fully above the bubble's ~160px top edge so the arrow
    // points down at it without overlapping. bottom-44 = 176px.
    render(<LiveChatCallout />);
    expect(screen.getByTestId("live-chat-callout").className).toContain("bottom-44");
  });

  it("raises the callout when the sticky FE call bar is visible", () => {
    render(<LiveChatCallout raised />);
    expect(screen.getByTestId("live-chat-callout").className).toContain("bottom-56");
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
