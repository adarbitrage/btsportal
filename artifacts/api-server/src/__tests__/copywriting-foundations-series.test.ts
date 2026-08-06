/**
 * Copywriting Foundations 9-doc series drift guard (Task #2095).
 *
 * Pure-constant + filesystem checks (no DB): keeps the rendered PDF assets,
 * the Creative Drive seed inventory, and the Resource Hub curation spec in
 * lockstep after the 8 → 9 reorder (angles docs at positions 2–3).
 */
import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COPYWRITING_FOUNDATIONS_FILES } from "../lib/seed-copywriting-foundations-drive.js";
import { CURATION_SPEC } from "../lib/resource-hub-setup.js";

const ASSETS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../assets/copywriting-foundations",
);

const EXPECTED_TITLES = [
  "What a Headline Actually Does",
  "Finding Your Angle",
  "Extracting Angles from Existing Copy",
  "Selling the Benefit, Not the Product",
  "Curiosity — Withholding the How",
  "Believability and Proof",
  "Headline Formulas and the Swipe File",
  "Word Choice — Context and Power",
  "The Headline Word Palette",
];

describe("Copywriting Foundations series (9 docs)", () => {
  it("has exactly 9 rendered PDFs with prefixes 01–09", () => {
    const pdfs = readdirSync(ASSETS_DIR).filter((f) => f.endsWith(".pdf")).sort();
    expect(pdfs).toHaveLength(9);
    expect(pdfs.map((f) => f.slice(0, 2))).toEqual(
      Array.from({ length: 9 }, (_, i) => String(i + 1).padStart(2, "0")),
    );
  });

  it("drive seed inventory matches the rendered assets and the new order", () => {
    expect(COPYWRITING_FOUNDATIONS_FILES).toHaveLength(9);
    const pdfs = new Set(readdirSync(ASSETS_DIR).filter((f) => f.endsWith(".pdf")));
    COPYWRITING_FOUNDATIONS_FILES.forEach((row, i) => {
      expect(row.sortOrder).toBe(i + 1);
      expect(pdfs.has(row.pdf)).toBe(true);
      expect(row.name).toBe(`${i + 1}. ${EXPECTED_TITLES[i]}.pdf`);
    });
  });

  it("resource hub curation has 9 entries whose derived filenames match the drive names", () => {
    const entries = CURATION_SPEC.filter(
      (e) => e.parentSlug === "foundations-copywriting" && e.kind === "file",
    ).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(entries).toHaveLength(9);
    entries.forEach((e, i) => {
      expect(e.slug).toBe(`foundations-copywriting-${i + 1}`);
      expect(e.displayTitle).toBe(EXPECTED_TITLES[i]);
      expect(e.fileName).toBe(COPYWRITING_FOUNDATIONS_FILES[i].name);
    });
  });

  it("group blurb says nine-part", () => {
    const group = CURATION_SPEC.find((e) => e.slug === "foundations-copywriting");
    expect(group?.blurb).toContain("nine-part");
  });
});
