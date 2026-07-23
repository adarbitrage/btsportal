import { describe, it, expect } from "vitest";

// Pure-unit coverage of the new TicketDesk chat-API status contract helpers:
//
//   - parseThreadStatus: reads the explicit `status` (+ `resolvedAt`)
//     TicketDesk exposes on the messages response. The critical invariant is
//     fail-open-to-unknown: an ABSENT or unrecognised status must parse as
//     null ("unknown"), NEVER as closed/resolved — so the poller makes no
//     status transition until TicketDesk actually ships the field.
//   - detectThreadClosed: thin boolean wrapper (resolved only on explicit
//     resolved status).
//   - inferAwaitingMemberReply: the "team replied, member hasn't yet" nudge —
//     true when the last directional message is agent-authored and the thread
//     isn't resolved.
//
// These are pure functions; no DB or network needed.
import {
  parseThreadStatus,
  detectThreadClosed,
  inferAwaitingMemberReply,
  isMemberMessage,
  isAgentMessage,
  type TicketDeskThreadMessage,
} from "../lib/ticketdesk-client";

function msg(type: string, id = "m1"): TicketDeskThreadMessage {
  return { id, type, body: "x" } as TicketDeskThreadMessage;
}

describe("parseThreadStatus", () => {
  it("returns unknown (null) when the response carries no status at all", () => {
    expect(parseThreadStatus(undefined)).toEqual({ status: null, resolvedAt: null });
    expect(parseThreadStatus(null)).toEqual({ status: null, resolvedAt: null });
    expect(parseThreadStatus({})).toEqual({ status: null, resolvedAt: null });
    expect(parseThreadStatus({ messages: [] })).toEqual({ status: null, resolvedAt: null });
  });

  it("returns unknown (null) for unrecognised status values — never closed", () => {
    expect(parseThreadStatus({ status: "banana" }).status).toBeNull();
    expect(parseThreadStatus({ status: 42 }).status).toBeNull();
    expect(parseThreadStatus({ status: "" }).status).toBeNull();
  });

  it("parses the three contract statuses", () => {
    expect(parseThreadStatus({ status: "open" }).status).toBe("open");
    expect(parseThreadStatus({ status: "in_progress" }).status).toBe("in_progress");
    expect(parseThreadStatus({ status: "resolved" }).status).toBe("resolved");
  });

  it("treats closed as an alias of resolved and normalizes case/whitespace", () => {
    expect(parseThreadStatus({ status: "closed" }).status).toBe("resolved");
    expect(parseThreadStatus({ status: " RESOLVED " }).status).toBe("resolved");
    expect(parseThreadStatus({ status: "In-Progress" }).status).toBe("in_progress");
  });

  it("reads status from nested conversation objects and alternate keys", () => {
    expect(parseThreadStatus({ conversation: { status: "resolved" } }).status).toBe("resolved");
    expect(parseThreadStatus({ conversationStatus: "in_progress" }).status).toBe("in_progress");
    expect(parseThreadStatus({ state: "open" }).status).toBe("open");
  });

  it("parses resolvedAt (camel and snake case, top-level and nested)", () => {
    const iso = "2026-07-01T12:00:00.000Z";
    expect(parseThreadStatus({ status: "resolved", resolvedAt: iso }).resolvedAt?.toISOString()).toBe(iso);
    expect(parseThreadStatus({ status: "resolved", resolved_at: iso }).resolvedAt?.toISOString()).toBe(iso);
    expect(
      parseThreadStatus({ conversation: { status: "resolved", resolved_at: iso } }).resolvedAt?.toISOString(),
    ).toBe(iso);
  });

  it("returns null resolvedAt for garbage timestamps", () => {
    expect(parseThreadStatus({ status: "resolved", resolvedAt: "not a date" }).resolvedAt).toBeNull();
  });

  it("models the auto-reopen: status back to open/in_progress with resolvedAt cleared", () => {
    const reopened = parseThreadStatus({ status: "open", resolvedAt: null });
    expect(reopened.status).toBe("open");
    expect(reopened.resolvedAt).toBeNull();
  });
});

describe("detectThreadClosed", () => {
  it("is true only on an explicit resolved status", () => {
    expect(detectThreadClosed([], { status: "resolved" })).toBe(true);
    expect(detectThreadClosed([], { status: "closed" })).toBe(true);
    expect(detectThreadClosed([], { status: "open" })).toBe(false);
    expect(detectThreadClosed([], { status: "in_progress" })).toBe(false);
    // Absent status = unknown, never closed.
    expect(detectThreadClosed([], {})).toBe(false);
    expect(detectThreadClosed([], undefined)).toBe(false);
  });
});

describe("message direction helpers", () => {
  it("classifies agent vs member message types", () => {
    expect(isAgentMessage(msg("chat_outbound"))).toBe(true);
    expect(isMemberMessage(msg("chat_inbound"))).toBe(true);
    expect(isAgentMessage(msg("chat_inbound"))).toBe(false);
    expect(isMemberMessage(msg("chat_outbound"))).toBe(false);
    // Unknown types carry no direction.
    expect(isAgentMessage(msg("system_note"))).toBe(false);
    expect(isMemberMessage(msg("system_note"))).toBe(false);
  });
});

describe("inferAwaitingMemberReply", () => {
  it("is true when the last directional message is agent-authored", () => {
    expect(
      inferAwaitingMemberReply([msg("chat_inbound", "a"), msg("chat_outbound", "b")], false),
    ).toBe(true);
  });

  it("is false when the member has replied last", () => {
    expect(
      inferAwaitingMemberReply([msg("chat_outbound", "a"), msg("chat_inbound", "b")], false),
    ).toBe(false);
  });

  it("ignores trailing non-directional messages", () => {
    expect(
      inferAwaitingMemberReply(
        [msg("chat_inbound", "a"), msg("chat_outbound", "b"), msg("system_note", "c")],
        false,
      ),
    ).toBe(true);
  });

  it("is always false when the thread is resolved", () => {
    expect(
      inferAwaitingMemberReply([msg("chat_inbound", "a"), msg("chat_outbound", "b")], true),
    ).toBe(false);
  });

  it("is false for an empty or member-only thread", () => {
    expect(inferAwaitingMemberReply([], false)).toBe(false);
    expect(inferAwaitingMemberReply([msg("chat_inbound")], false)).toBe(false);
  });
});
