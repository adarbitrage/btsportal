import { describe, it, expect } from "vitest";

import {
  DEFAULT_TICKETDESK_URL,
  DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL,
  DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID,
  DEFAULT_TICKETDESK_WIDGET_API_URL,
  validateTicketAttachment,
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENT_MAX_LABEL,
  TICKET_STATUSES,
  ACTIVE_TICKET_STATUSES,
  TERMINAL_TICKET_STATUSES,
  isActiveTicketStatus,
  isAwaitingMember,
  MEMBER_SUBMISSION_STATUS_LABELS,
  formatMemberSubmissionStatus,
} from "./index";

describe("DEFAULT_TICKETDESK_URL", () => {
  it("is a valid absolute URL", () => {
    expect(() => new URL(DEFAULT_TICKETDESK_URL)).not.toThrow();
    expect(DEFAULT_TICKETDESK_URL).toMatch(/^https?:\/\//);
  });
});

describe("DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL", () => {
  it("is a valid absolute URL", () => {
    expect(() => new URL(DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL)).not.toThrow();
    expect(DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL).toMatch(/^https?:\/\//);
  });

  it("ends with widget.js", () => {
    expect(DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL).toMatch(/widget\.js$/);
  });

  it("is on the same host as DEFAULT_TICKETDESK_URL", () => {
    const widgetHost = new URL(DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL).host;
    const rootHost = new URL(DEFAULT_TICKETDESK_URL).host;
    expect(widgetHost).toBe(rootHost);
  });
});

describe("DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID", () => {
  it("is a non-empty string", () => {
    expect(typeof DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID).toBe("string");
    expect(DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID.trim().length).toBeGreaterThan(0);
  });
});

describe("DEFAULT_TICKETDESK_WIDGET_API_URL", () => {
  it("is a valid absolute URL", () => {
    expect(() => new URL(DEFAULT_TICKETDESK_WIDGET_API_URL)).not.toThrow();
    expect(DEFAULT_TICKETDESK_WIDGET_API_URL).toMatch(/^https?:\/\//);
  });

  it("is on the same host as DEFAULT_TICKETDESK_URL", () => {
    const apiHost = new URL(DEFAULT_TICKETDESK_WIDGET_API_URL).host;
    const rootHost = new URL(DEFAULT_TICKETDESK_URL).host;
    expect(apiHost).toBe(rootHost);
  });
});

describe("validateTicketAttachment", () => {
  it("accepts an allowed type within the size limit", () => {
    expect(
      validateTicketAttachment({
        fileName: "report.pdf",
        fileSize: 1024,
        contentType: "application/pdf",
      }),
    ).toBeNull();
  });

  it("rejects an unsupported content type", () => {
    const error = validateTicketAttachment({
      fileName: "malware.exe",
      fileSize: 1024,
      contentType: "application/x-msdownload",
    });
    expect(error).toBeTruthy();
    expect(error).toContain("malware.exe");
    expect(error).toContain("Allowed types");
  });

  it("rejects a file over the size limit", () => {
    const error = validateTicketAttachment({
      fileName: "huge.png",
      fileSize: TICKET_ATTACHMENT_MAX_BYTES + 1,
      contentType: "image/png",
    });
    expect(error).toBeTruthy();
    expect(error).toContain("too large");
    expect(error).toContain(TICKET_ATTACHMENT_MAX_LABEL);
  });

  it("accepts a file exactly at the size limit", () => {
    expect(
      validateTicketAttachment({
        fileName: "edge.png",
        fileSize: TICKET_ATTACHMENT_MAX_BYTES,
        contentType: "image/png",
      }),
    ).toBeNull();
  });

  it("rejects a missing content type", () => {
    expect(
      validateTicketAttachment({ fileName: "x", fileSize: 1, contentType: null }),
    ).toBeTruthy();
  });
});

describe("ticket status constants", () => {
  it("partitions every status into exactly one of active/terminal", () => {
    const partitioned = [...ACTIVE_TICKET_STATUSES, ...TERMINAL_TICKET_STATUSES];
    expect([...partitioned].sort()).toEqual([...TICKET_STATUSES].sort());
    // No status appears in both buckets.
    for (const s of ACTIVE_TICKET_STATUSES) {
      expect(TERMINAL_TICKET_STATUSES).not.toContain(s);
    }
  });

  it("has a member label for every status", () => {
    for (const s of TICKET_STATUSES) {
      expect(MEMBER_SUBMISSION_STATUS_LABELS[s]).toBeTruthy();
    }
  });

  it("isActiveTicketStatus is true only for active statuses", () => {
    expect(isActiveTicketStatus("open")).toBe(true);
    expect(isActiveTicketStatus("in_progress")).toBe(true);
    expect(isActiveTicketStatus("awaiting_response")).toBe(true);
    expect(isActiveTicketStatus("resolved")).toBe(false);
    expect(isActiveTicketStatus("closed")).toBe(false);
    expect(isActiveTicketStatus(null)).toBe(false);
    expect(isActiveTicketStatus(undefined)).toBe(false);
  });

  it("isAwaitingMember is true only for awaiting_response", () => {
    expect(isAwaitingMember("awaiting_response")).toBe(true);
    expect(isAwaitingMember("open")).toBe(false);
    expect(isAwaitingMember(null)).toBe(false);
  });

  it("labels active statuses 'In progress' and terminal 'Complete'", () => {
    expect(formatMemberSubmissionStatus("open")).toBe("In progress");
    expect(formatMemberSubmissionStatus("in_progress")).toBe("In progress");
    expect(formatMemberSubmissionStatus("awaiting_response")).toBe("In progress");
    expect(formatMemberSubmissionStatus("resolved")).toBe("Complete");
    expect(formatMemberSubmissionStatus("closed")).toBe("Complete");
  });

  it("falls back to 'In progress' for unknown/empty status", () => {
    expect(formatMemberSubmissionStatus("some_future_status")).toBe("In progress");
    expect(formatMemberSubmissionStatus(null)).toBe("In progress");
    expect(formatMemberSubmissionStatus(undefined)).toBe("In progress");
  });
});
