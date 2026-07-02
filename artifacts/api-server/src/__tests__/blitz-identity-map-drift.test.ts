import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BLITZ_SECTION_BY_ID, BLITZ_SECTION_IDS } from "@workspace/blitz-curriculum";
import { BLITZ_SECTION_TO_NODE, isProcessNode } from "../lib/kb-taxonomy";
import { CORE_TRAINING_PROSE_TITLES } from "../lib/seed-core-training-sources";
import {
  BLITZ_IDENTITY_CROSSWALK,
  BLITZ_ORDER_COLLISIONS,
  BLITZ_SECTION_COVERAGE,
  blitzSourceDocTitle,
  resolveBlitzLessonId,
  resolveBlitzSourceDoc,
} from "../lib/blitz-identity-map";

/**
 * Ground-truth reference-doc source set: every non-rejected `blitz_lessons`
 * title from the in-repo seed (deterministic; buildCoreTrainingSourceDocs reads
 * the DB, which is empty in a fresh test env) + the two core-training prose
 * titles. If the curriculum or source set changes, this drift guard fails until
 * the identity map is updated — exactly like `kb-taxonomy-blitz-drift`.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "blitz-seed.json"), "utf8"),
) as { title: string; lesson_id: string | null; blitz_order: number; status?: string }[];

const expectedLessonTitles = seed
  .filter((l) => l.status !== "rejected")
  .map((l) => blitzSourceDocTitle(l.title));
const expectedSourceDocTitles = [...expectedLessonTitles, ...CORE_TRAINING_PROSE_TITLES].sort();

describe("Blitz identity map — source-doc coverage drift guard", () => {
  it("covers EXACTLY the expected reference-doc source set (no missing, no extra)", () => {
    const mapped = BLITZ_IDENTITY_CROSSWALK.map((e) => e.sourceDocTitle).sort();
    expect(mapped).toEqual(expectedSourceDocTitles);
  });

  it("has one entry per reference doc (no duplicate source-doc titles)", () => {
    const titles = BLITZ_IDENTITY_CROSSWALK.map((e) => e.sourceDocTitle);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.length).toBe(expectedSourceDocTitles.length);
  });

  it("keeps the two core-training prose entries in lockstep with the seeder", () => {
    const prose = BLITZ_IDENTITY_CROSSWALK.filter((e) => e.kind === "prose")
      .map((e) => e.sourceDocTitle)
      .sort();
    expect(prose).toEqual([...CORE_TRAINING_PROSE_TITLES].sort());
  });

  it("covers every distinct internal lesson_id present in the seed", () => {
    const seedLessonIds = [...new Set(seed.map((l) => l.lesson_id).filter(Boolean))].sort();
    const mappedLessonIds = [
      ...new Set(BLITZ_IDENTITY_CROSSWALK.map((e) => e.lessonId).filter(Boolean)),
    ].sort() as string[];
    expect(mappedLessonIds).toEqual(seedLessonIds);
  });
});

describe("Blitz identity map — target validity", () => {
  it("maps every entry to a real canonical Blitz section (1..23)", () => {
    const canonical = new Set(BLITZ_SECTION_IDS);
    for (const e of BLITZ_IDENTITY_CROSSWALK) {
      expect(canonical.has(e.section), `"${e.sourceDocTitle}" → unknown section ${e.section}`).toBe(
        true,
      );
      expect(e.sectionMeta).toBe(BLITZ_SECTION_BY_ID[e.section]);
      expect(e.sectionAnchor).toBe(BLITZ_SECTION_BY_ID[e.section].sectionAnchor);
      expect(e.courseId).toBe(BLITZ_SECTION_BY_ID[e.section].courseId);
      expect(e.phase).toBe(BLITZ_SECTION_BY_ID[e.section].phase);
    }
  });

  it("maps every entry to a real Process node via BLITZ_SECTION_TO_NODE", () => {
    for (const e of BLITZ_IDENTITY_CROSSWALK) {
      expect(e.processNode).toBe(BLITZ_SECTION_TO_NODE[e.section]);
      expect(
        isProcessNode(e.processNode),
        `"${e.sourceDocTitle}" → non-process node "${e.processNode}"`,
      ).toBe(true);
    }
  });

  it("derives lesson source-doc titles via the shared prefix contract", () => {
    for (const e of BLITZ_IDENTITY_CROSSWALK) {
      if (e.kind !== "lesson") continue;
      expect(e.sourceDocTitle.startsWith("The Blitz™ Lesson — ")).toBe(true);
    }
  });
});

describe("Blitz identity map — resolvers + report data", () => {
  it("resolves reference-doc titles and lesson_ids back to entries", () => {
    const sample = BLITZ_IDENTITY_CROSSWALK.find((e) => e.lessonId === "3.18b");
    expect(sample).toBeTruthy();
    expect(resolveBlitzSourceDoc(sample!.sourceDocTitle)).toBe(sample);
    expect(resolveBlitzLessonId("3.18b")).toBe(sample);
    expect(resolveBlitzSourceDoc("not a real doc")).toBeNull();
    expect(resolveBlitzLessonId("999.999")).toBeNull();
  });

  it("coverage counts add up to the full crosswalk", () => {
    const total = Object.values(BLITZ_SECTION_COVERAGE).reduce((a, b) => a + b, 0);
    expect(total).toBe(BLITZ_IDENTITY_CROSSWALK.length);
    for (const id of BLITZ_SECTION_IDS) {
      expect(BLITZ_SECTION_COVERAGE[id]).toBeGreaterThanOrEqual(0);
    }
  });

  it("documents the real blitz_order collisions present in the seed", () => {
    const byOrder = new Map<number, string[]>();
    for (const l of seed) {
      if (!l.lesson_id) continue;
      const list = byOrder.get(l.blitz_order) ?? [];
      list.push(l.lesson_id);
      byOrder.set(l.blitz_order, list);
    }
    const actualCollisions = [...byOrder.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([order, ids]) => ({ order, lessonIds: ids.sort() }))
      .sort((a, b) => a.order - b.order);

    const documented = BLITZ_ORDER_COLLISIONS.map((c) => ({
      order: c.order,
      lessonIds: [...c.lessonIds].sort(),
    })).sort((a, b) => a.order - b.order);

    expect(documented).toEqual(actualCollisions);
  });
});
