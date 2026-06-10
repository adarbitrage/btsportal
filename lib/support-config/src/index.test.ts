import { describe, it, expect } from "vitest";

import { DEFAULT_TICKETDESK_URL } from "./index";

describe("DEFAULT_TICKETDESK_URL", () => {
  it("is a valid absolute URL", () => {
    expect(() => new URL(DEFAULT_TICKETDESK_URL)).not.toThrow();
    expect(DEFAULT_TICKETDESK_URL).toMatch(/^https?:\/\//);
  });
});
