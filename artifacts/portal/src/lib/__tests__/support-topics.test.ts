import { describe, it, expect } from "vitest";
import { formatTicketCategory } from "@/lib/support-topics";

describe("formatTicketCategory", () => {
  it("maps known single-word categories to their labels", () => {
    expect(formatTicketCategory("billing")).toBe("Billing");
    expect(formatTicketCategory("technical")).toBe("Technical");
    expect(formatTicketCategory("training")).toBe("Training");
    expect(formatTicketCategory("account")).toBe("Account");
    expect(formatTicketCategory("other")).toBe("Other");
  });

  it("maps snake_case service categories to human labels", () => {
    expect(formatTicketCategory("concierge_task")).toBe("Concierge Task");
    expect(formatTicketCategory("compliance_review")).toBe("Compliance Review");
  });

  it("falls back to Title Case for unknown/future snake_case values", () => {
    expect(formatTicketCategory("priority_escalation")).toBe("Priority Escalation");
    expect(formatTicketCategory("refund")).toBe("Refund");
  });

  it("returns an empty string for null/undefined/empty input", () => {
    expect(formatTicketCategory(null)).toBe("");
    expect(formatTicketCategory(undefined)).toBe("");
    expect(formatTicketCategory("")).toBe("");
  });
});
