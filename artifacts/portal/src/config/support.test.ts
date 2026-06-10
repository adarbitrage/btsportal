import { describe, it, expect } from "vitest";

import { DEFAULT_TICKETDESK_URL } from "@workspace/support-config";
import { TICKETDESK_URL } from "./support";

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
