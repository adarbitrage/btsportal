import { describe, it, expect, vi } from "vitest";

// The transformer functions are pure — mock the db barrel (only the bulk
// importer touches it) and the DB-backed tool-tag cache so the module loads
// without a live database.
vi.mock("@workspace/db", () => ({
  db: {},
  kbStagingDocsTable: {},
  aiSourceDocumentsTable: {},
}));
vi.mock("../lib/kb-tool-tags", () => ({
  getEffectiveTags: () => ["flexy", "compliance"],
  getEffectiveTagTriggers: () => ({
    flexy: ["flexy"],
    compliance: ["compliance", "ad split test"],
  }),
}));

import {
  parseReferenceDoc,
  cleanBlitzTitle,
  rewriteLessonReferences,
  classifyReviewEffort,
  transformBlitzReferenceDoc,
  blitzAnchorPhrase,
  BLITZ_REFERENCE_IMPORT_SOURCE,
} from "../lib/blitz-reference-import";
import {
  BLITZ_IDENTITY_CROSSWALK,
  resolveBlitzLessonId,
} from "../lib/blitz-identity-map";

const lessonEntry = BLITZ_IDENTITY_CROSSWALK.find((e) => e.kind === "lesson")!;
const proseEntry = BLITZ_IDENTITY_CROSSWALK.find((e) => e.kind === "prose")!;

describe("parseReferenceDoc", () => {
  it("strips the internal heading + **Field:** metadata block and keeps the body", () => {
    const raw = [
      "# 4.4: Submit Ad Split Test Media to Compliance",
      "",
      "**Phase:** Build",
      "**Module:** Compliance",
      "**Category:** procedure",
      "**Applies to:** All members",
      "**Topics:** compliance, ad split test",
      "",
      "First real content line.",
      "",
      "Second paragraph.",
    ].join("\n");
    const { header, body } = parseReferenceDoc(raw);
    expect(header.phase).toBe("Build");
    expect(header.module).toBe("Compliance");
    expect(header.category).toBe("procedure");
    expect(header.appliesTo).toBe("All members");
    expect(header.topics).toEqual(["compliance", "ad split test"]);
    expect(body.startsWith("First real content line.")).toBe(true);
    expect(body).not.toContain("**Phase:**");
    expect(body).not.toContain("# 4.4:");
  });

  it("handles docs with no metadata header at all", () => {
    const { header, body } = parseReferenceDoc("Just prose.\n\nMore prose.");
    expect(header.phase).toBeNull();
    expect(header.topics).toEqual([]);
    expect(body).toBe("Just prose.\n\nMore prose.");
  });
});

describe("cleanBlitzTitle", () => {
  it("removes the internal numbering prefix and Core Training suffix from every crosswalk entry", () => {
    for (const entry of BLITZ_IDENTITY_CROSSWALK) {
      const t = cleanBlitzTitle(entry);
      expect(t.length).toBeGreaterThan(0);
      expect(t).not.toMatch(/^\d{1,2}[AB]?\.\d{1,2}[ab]?\s*[:.]/);
      expect(t).not.toMatch(/\(Core Training\)\s*$/);
      expect(t.startsWith("The Blitz™ Lesson — ")).toBe(false);
    }
  });
});

describe("blitzAnchorPhrase", () => {
  it("intro sections anchor to the Introduction, others to their phase", () => {
    for (const entry of BLITZ_IDENTITY_CROSSWALK) {
      const phrase = blitzAnchorPhrase(entry);
      expect(phrase).toContain(`Section ${entry.section} ("`);
      if (entry.phase === "intro") {
        expect(phrase).toContain("in the Introduction of the Blitz guide");
      } else {
        expect(phrase).toMatch(/in the (Build|Test|Scale) phase of the Blitz guide$/);
      }
    }
  });
});

describe("rewriteLessonReferences", () => {
  const knownId = lessonEntry.lessonId!;

  it("rewrites a resolvable internal reference to the member-facing anchor phrase", () => {
    const { text, unresolved } = rewriteLessonReferences(
      `When done, proceed to Lesson ${knownId}, where you continue.`,
    );
    expect(unresolved).toEqual([]);
    expect(text).not.toContain(knownId);
    expect(text).toContain(blitzAnchorPhrase(resolveBlitzLessonId(knownId)!));
  });

  it("drops the quoted internal title attached to a reference", () => {
    const { text } = rewriteLessonReferences(
      `See Lesson ${knownId}: "Some Internal Lesson Title" for details.`,
    );
    expect(text).not.toContain("Some Internal Lesson Title");
  });

  it("neutralizes unresolvable ids and reports them", () => {
    const { text, unresolved } = rewriteLessonReferences("Proceed to Lesson 99.99 next.");
    expect(unresolved).toEqual(["99.99"]);
    expect(text).toContain("a later step in the Blitz guide");
    expect(text).not.toContain("99.99");
  });
});

describe("classifyReviewEffort", () => {
  it("flags a portal click-path doc as nav_check (medium when a label is missing from the nav map)", () => {
    const doc = [
      "Log in to your portal.",
      "Navigate to **Totally Nonexistent Menu** > **Another Fake Page**.",
      "Click submit.",
    ].join("\n");
    const c = classifyReviewEffort(doc);
    expect(c.effort).toBe("nav_check");
    expect(c.navFlag).not.toBeNull();
    expect(c.navFlag!.type).toBe("portal_nav_check");
    expect(c.navFlag!.severity).toBe("medium");
    expect(c.unmatchedLabels).toContain("Totally Nonexistent Menu");
  });

  it("classifies a third-party tool procedure (no portal mention) as skim with no flag", () => {
    const doc = [
      "Open Flexy and create a new page.",
      "Click **New Project** and paste your ad copy.",
    ].join("\n");
    const c = classifyReviewEffort(doc);
    expect(c.effort).toBe("skim");
    expect(c.navFlag).toBeNull();
  });
});

describe("transformBlitzReferenceDoc", () => {
  it("returns null for a title not in the drift-guarded crosswalk", () => {
    expect(transformBlitzReferenceDoc("Not A Real Source Doc", "body")).toBeNull();
  });

  it("produces a clean member-safe draft for a real lesson source", () => {
    const raw = [
      `# ${lessonEntry.lessonId}: Internal Title`,
      "",
      "**Phase:** Build",
      "**Module:** Compliance",
      "**Topics:** compliance",
      "",
      "Log in to your portal and navigate to **Totally Nonexistent Menu**.",
      `Then proceed to Lesson ${lessonEntry.lessonId}.`,
    ].join("\n");
    const t = transformBlitzReferenceDoc(lessonEntry.sourceDocTitle, raw)!;
    expect(t).not.toBeNull();
    expect(t.title).toBe(cleanBlitzTitle(lessonEntry));
    // Header scaffolding stripped, internal numbering gone.
    expect(t.content).not.toContain("**Phase:**");
    expect(t.content).not.toContain(`Lesson ${lessonEntry.lessonId}`);
    // Portal click-path → nav_check flag + NAV CHECK guidance note.
    expect(t.effort).toBe("nav_check");
    expect(t.riskFlags.map((f) => f.type)).toContain("portal_nav_check");
    expect(t.adminNotes).toContain("NAV CHECK");
    expect(t.adminNotes).toContain(lessonEntry.sourceDocTitle);
    // Lesson docs default to the operational ceiling.
    expect(t.ceiling).toBe("operational");
    // Taxonomy tags detected via the (mocked) effective tool-tag vocabulary.
    expect(t.taxonomyTags).toContain("compliance");
  });

  it("prose sources get the conceptual ceiling and skim guidance without portal mentions", () => {
    const t = transformBlitzReferenceDoc(
      proseEntry.sourceDocTitle,
      "Strategy prose with no portal steps at all.",
    )!;
    expect(t).not.toBeNull();
    expect(t.ceiling).toBe("conceptual");
    expect(t.effort).toBe("skim");
    expect(t.riskFlags).toEqual([]);
    expect(t.adminNotes).toContain("SKIM");
  });

  it("exports the idempotency marker the routes + triage key off", () => {
    expect(BLITZ_REFERENCE_IMPORT_SOURCE).toBe("blitz_reference_import");
  });
});
