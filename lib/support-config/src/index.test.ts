import { describe, it, expect } from "vitest";

import {
  DEFAULT_TICKETDESK_URL,
  DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL,
  DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID,
  DEFAULT_TICKETDESK_WIDGET_API_URL,
  validateTicketAttachment,
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENT_MAX_LABEL,
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
