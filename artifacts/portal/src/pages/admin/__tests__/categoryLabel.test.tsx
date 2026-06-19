import { describe, expect, it } from "vitest";
import { CATEGORY_LABELS, categoryLabel } from "../AdminTicketQueue";

describe("categoryLabel known slugs", () => {
  const cases: Array<[string, string]> = [
    ["billing", "Billing"],
    ["technical", "Technical"],
    ["training", "Training"],
    ["account", "Account"],
    ["other", "Other"],
    ["concierge_task", "Concierge Task"],
    ["compliance_review", "Compliance Review"],
  ];

  it.each(cases)("maps %s -> %s", (slug, label) => {
    expect(categoryLabel(slug)).toBe(label);
  });

  it("covers every slug declared in CATEGORY_LABELS", () => {
    // Guards against a label being removed from the map without the test
    // being updated in lockstep.
    const tested = new Set(cases.map(([slug]) => slug));
    for (const slug of Object.keys(CATEGORY_LABELS)) {
      expect(tested.has(slug)).toBe(true);
    }
  });
});

describe("categoryLabel unknown slugs", () => {
  it("falls back to slug-to-Title-Case for an unknown slug", () => {
    expect(categoryLabel("new_thing")).toBe("New Thing");
  });

  it("Title-Cases a single-word unknown slug", () => {
    expect(categoryLabel("escalation")).toBe("Escalation");
  });

  it("handles multi-underscore unknown slugs", () => {
    expect(categoryLabel("very_long_category_name")).toBe(
      "Very Long Category Name",
    );
  });

  it("never returns the raw slug for a known category", () => {
    expect(categoryLabel("concierge_task")).not.toBe("concierge_task");
    expect(categoryLabel("compliance_review")).not.toBe("compliance_review");
  });
});
