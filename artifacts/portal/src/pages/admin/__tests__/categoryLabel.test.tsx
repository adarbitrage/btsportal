import { describe, expect, it } from "vitest";
import {
  MEMBER_TICKET_CATEGORIES,
  TICKET_CATEGORIES,
} from "@workspace/support-config";
import {
  CreateTicketCategory,
  TicketCategory,
  TicketWithMessagesCategory,
} from "@workspace/api-client-react";
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

describe("CATEGORY_LABELS coverage", () => {
  // Guards against the silent slug-to-Title-Case fallback shipping for a real
  // backend category. Every category the backend can emit (the authoritative
  // list in @workspace/support-config) must have an explicit, curated label —
  // adding a new category there without a label here fails CI.
  it("has an explicit curated label for every backend category", () => {
    for (const slug of TICKET_CATEGORIES) {
      expect(
        Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, slug),
        `Missing curated CATEGORY_LABELS entry for ticket category "${slug}". ` +
          `Add it to CATEGORY_LABELS in AdminTicketQueue.tsx.`,
      ).toBe(true);
    }
  });

  it("does not declare labels for unknown categories", () => {
    // Keeps the curated map in lockstep with the shared list so a stale label
    // (e.g. a removed/renamed category) is caught too.
    const known = new Set<string>(TICKET_CATEGORIES);
    for (const slug of Object.keys(CATEGORY_LABELS)) {
      expect(
        known.has(slug),
        `CATEGORY_LABELS declares "${slug}", which is not in TICKET_CATEGORIES ` +
          `(@workspace/support-config). Remove it or add it to the shared list.`,
      ).toBe(true);
    }
  });

  it("includes every category in the generated API-client enum", () => {
    // The member-facing categories are an OpenAPI enum; the generated client
    // is regenerated from the spec. If the backend adds a new enum value and
    // the clients are regenerated, this fails until the value is added to the
    // shared TICKET_CATEGORIES list (which in turn forces a curated label).
    const generated = new Set<string>([
      ...Object.values(TicketCategory),
      ...Object.values(CreateTicketCategory),
    ]);
    const known = new Set<string>(TICKET_CATEGORIES);
    for (const slug of generated) {
      expect(
        known.has(slug),
        `Generated API-client category "${slug}" is missing from ` +
          `TICKET_CATEGORIES (@workspace/support-config). Add it there ` +
          `and give it a curated CATEGORY_LABELS entry.`,
      ).toBe(true);
    }
  });
});

describe("ticket-detail response category enum (TicketWithMessagesCategory)", () => {
  // The ticket *detail* response (TicketWithMessages) enumerates every real
  // category, including the two internal ones (concierge_task,
  // compliance_review). The admin-queue guards above only cross-check the queue
  // enums (TicketCategory + CreateTicketCategory). Without this block a future
  // spec edit could drop an internal category from the detail contract — so the
  // detail page would silently fall back to slug-cased text for it — with no
  // test failing. These two checks tie the detail enum to the shared list.

  it("covers every value in TICKET_CATEGORIES", () => {
    // The detail response must surface ALL real categories (member-facing AND
    // internal), so the generated enum must be a superset of the shared list.
    const detail = new Set<string>(Object.values(TicketWithMessagesCategory));
    for (const slug of TICKET_CATEGORIES) {
      expect(
        detail.has(slug),
        `Ticket category "${slug}" (TICKET_CATEGORIES, ` +
          `@workspace/support-config) is missing from the generated ` +
          `TicketWithMessagesCategory enum. The detail response dropped a ` +
          `real category — restore it to the TicketWithMessages "category" ` +
          `enum in openapi.yaml and regenerate the client.`,
      ).toBe(true);
    }
  });

  it("does not enumerate any category outside TICKET_CATEGORIES", () => {
    // Keeps the detail enum in lockstep with the shared list, so a stale or
    // renamed value is caught too.
    const known = new Set<string>(TICKET_CATEGORIES);
    for (const slug of Object.values(TicketWithMessagesCategory)) {
      expect(
        known.has(slug),
        `Generated TicketWithMessagesCategory enumerates "${slug}", which is ` +
          `not in TICKET_CATEGORIES (@workspace/support-config). Remove it ` +
          `from the detail enum or add it to the shared list.`,
      ).toBe(true);
    }
  });
});

describe("create-ticket category enum stays member-facing only", () => {
  // Members can only ever pick the 5 member-facing categories when opening a
  // ticket. The internal categories (concierge_task, compliance_review) are
  // stamped by the backend and must never become member-selectable. This pins
  // the generated create enum to exactly MEMBER_TICKET_CATEGORIES so an
  // accidental spec edit that leaks an internal category into the create
  // contract fails CI.
  it("equals MEMBER_TICKET_CATEGORIES exactly", () => {
    const create = new Set<string>(Object.values(CreateTicketCategory));
    const member = new Set<string>(MEMBER_TICKET_CATEGORIES);

    for (const slug of create) {
      expect(
        member.has(slug),
        `Generated CreateTicketCategory enumerates "${slug}", which is not a ` +
          `member-facing category (MEMBER_TICKET_CATEGORIES, ` +
          `@workspace/support-config). Members must never be able to select ` +
          `internal categories — remove it from the CreateTicketBody ` +
          `"category" enum in openapi.yaml.`,
      ).toBe(true);
    }

    for (const slug of member) {
      expect(
        create.has(slug),
        `Member-facing category "${slug}" (MEMBER_TICKET_CATEGORIES) is ` +
          `missing from the generated CreateTicketCategory enum. Add it back ` +
          `to the CreateTicketBody "category" enum in openapi.yaml and ` +
          `regenerate the client.`,
      ).toBe(true);
    }
  });
});
