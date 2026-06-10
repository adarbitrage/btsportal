import { describe, it, expect } from "vitest";

import {
  DEFAULT_TICKETDESK_URL,
  DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL,
  DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID,
  DEFAULT_TICKETDESK_WIDGET_API_URL,
} from "@workspace/support-config";
import {
  TICKETDESK_URL,
  TICKETDESK_WIDGET_SCRIPT_URL,
  TICKETDESK_WIDGET_WORKSPACE_ID,
  TICKETDESK_WIDGET_API_URL,
} from "./support";

describe("TICKETDESK_URL lockstep", () => {
  it("falls back to the shared support-config default when no env override is set", () => {
    // The portal embed and the backend health probe both derive their default
    // from `@workspace/support-config`. Without a VITE_TICKETDESK_URL override,
    // the embed URL members load must equal that shared default, so it can
    // never silently diverge from the URL System Health probes.
    if (!process.env.VITE_TICKETDESK_URL) {
      expect(TICKETDESK_URL).toBe(DEFAULT_TICKETDESK_URL);
    }
  });
});

describe("TICKETDESK_WIDGET_SCRIPT_URL lockstep", () => {
  it("falls back to the shared support-config default when no env override is set", () => {
    if (!process.env.VITE_TICKETDESK_WIDGET_SCRIPT_URL) {
      expect(TICKETDESK_WIDGET_SCRIPT_URL).toBe(DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL);
    }
  });
});

describe("TICKETDESK_WIDGET_WORKSPACE_ID lockstep", () => {
  it("falls back to the shared support-config default when no env override is set", () => {
    if (!process.env.VITE_TICKETDESK_WIDGET_WORKSPACE_ID) {
      expect(TICKETDESK_WIDGET_WORKSPACE_ID).toBe(DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID);
    }
  });
});

describe("TICKETDESK_WIDGET_API_URL lockstep", () => {
  it("falls back to the shared support-config default when no env override is set", () => {
    if (!process.env.VITE_TICKETDESK_WIDGET_API_URL) {
      expect(TICKETDESK_WIDGET_API_URL).toBe(DEFAULT_TICKETDESK_WIDGET_API_URL);
    }
  });
});
