import { describe, it, expect } from "vitest";

import {
  DEFAULT_TICKETDESK_URL,
  DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL,
  DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID,
  DEFAULT_TICKETDESK_WIDGET_API_URL,
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
