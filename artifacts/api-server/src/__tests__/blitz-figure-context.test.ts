import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  normalizeFigure,
  contextTokens,
  contextOverlaps,
  buildFigureVerifier,
  figureVerifierForDoc,
  BLITZ_SECTION_SOURCE,
} from "../lib/blitz-figure-context";
import { analyzeDraftForReview } from "../lib/kb-review-risk";
import { extractBlitzSections } from "../lib/blitz-section-extract";

const GUIDE = [
  "Set your daily budget to $50 per day when launching a new campaign.",
  "Aim for a 2% click-through rate before scaling.",
  "- Scale in $10 increments once the ad is profitable.",
].join("\n");

describe("blitz-figure-context", () => {
  it("normalizes figure spellings so guide and doc variants compare equal", () => {
    expect(normalizeFigure("$ 1,500")).toBe(normalizeFigure("$1500"));
    expect(normalizeFigure("50 / day")).toBe(normalizeFigure("50 per day"));
    expect(normalizeFigure("$50")).not.toBe(normalizeFigure("$40"));
  });

  it("suppresses a figure restated in the same context as the written guide", () => {
    const verify = buildFigureVerifier([GUIDE]);
    expect(
      verify("$50", "When you launch a new campaign, set the daily budget to $50."),
    ).toBe(true);
  });

  it("keeps flagging the same figure used for a DIFFERENT claim", () => {
    const verify = buildFigureVerifier([GUIDE]);
    // $50 exists in the guide as a daily-budget guideline, but this line is a
    // kill-threshold claim — different context, must stay flagged.
    expect(
      verify("$50", "Don't cut an ad until it reaches $50 in total spend."),
    ).toBe(false);
  });

  it("keeps flagging figures that never appear in the guide", () => {
    const verify = buildFigureVerifier([GUIDE]);
    expect(verify("$75", "Set your daily budget to $75 when launching.")).toBe(false);
  });

  it("requires meaningful token overlap, not just any shared word", () => {
    const a = contextTokens("set daily budget launching new campaign");
    const b = contextTokens("cut ad reaches total spend");
    expect(contextOverlaps(a, b)).toBe(false);
    expect(contextOverlaps(a, contextTokens("daily budget for a new campaign"))).toBe(true);
  });

  it("analyzeDraftForReview drops corroborated figures and keeps the rest", () => {
    const verify = buildFigureVerifier([GUIDE]);
    const content = [
      "Set your daily budget to $50 per day for a new campaign.",
      "One member spent $900 in a week before their first sale.",
    ].join("\n");
    const kinds = analyzeDraftForReview(content, { figureVerifier: verify })
      .filter((h) => h.kind === "situational_number")
      .map((h) => h.excerpt);
    expect(kinds).not.toContain("$50");
    expect(kinds).toContain("$900");
  });

  it("without a verifier all figures stay flagged (non-Blitz docs unchanged)", () => {
    const content = "Set your daily budget to $50 per day.";
    const flagged = analyzeDraftForReview(content).filter(
      (h) => h.kind === "situational_number",
    );
    expect(flagged.length).toBeGreaterThan(0);
  });

  it("figureVerifierForDoc only applies to blitz_section_import docs", () => {
    expect(figureVerifierForDoc("coaching_call")).toBeUndefined();
    expect(figureVerifierForDoc(null)).toBeUndefined();
    expect(figureVerifierForDoc(undefined)).toBeUndefined();
    // Blitz docs get a real verifier built from the current written guide.
    expect(typeof figureVerifierForDoc(BLITZ_SECTION_SOURCE)).toBe("function");
  });

  it("BLITZ_SECTION_SOURCE stays in lockstep with blitz-section-docgen", () => {
    // Read the docgen source instead of importing it (it pulls the LLM seam).
    const docgenPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../lib/blitz-section-docgen.ts",
    );
    const src = readFileSync(docgenPath, "utf8");
    const m = src.match(/BLITZ_SECTION_IMPORT_SOURCE\s*=\s*"([^"]+)"/);
    expect(m?.[1]).toBe(BLITZ_SECTION_SOURCE);
  });

  it("real-guide verifier corroborates an actual written-guide figure line", () => {
    // Smoke test against the live extracted guide: pick a real sentence with a
    // figure and confirm it verifies against itself.
    const verify = figureVerifierForDoc(BLITZ_SECTION_SOURCE)!;
    const texts = extractBlitzSections().map((s) => s.guideText);
    const figureRe = /\$\s?\d[\d,]*(?:\.\d+)?[kKmM]?\b|\b\d{1,3}(?:\.\d+)?\s?%/;
    let found = false;
    outer: for (const t of texts) {
      for (const line of t.split("\n")) {
        const m = line.match(figureRe);
        if (m && contextTokens(line).size >= 2) {
          expect(verify(m[0], line)).toBe(true);
          found = true;
          break outer;
        }
      }
    }
    // Non-vacuous: the written guide must actually contain a figure line.
    expect(found).toBe(true);
  });

  it("FIGURE_PATTERNS stays in lockstep with kb-review-risk NUMBER_PATTERNS", () => {
    // Read both sources and compare the pattern blocks so the verifier can
    // never index a different figure shape than the analyzer flags.
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const extract = (file: string, name: string) => {
      const src = readFileSync(path.resolve(dir, file), "utf8");
      const m = src.match(new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\];`));
      expect(m, `${name} not found in ${file}`).toBeTruthy();
      return m![1]
        .split("\n")
        .map((l) => l.replace(/\/\/.*$/, "").trim().replace(/,$/, ""))
        .filter(Boolean)
        .join("\n");
    };
    expect(extract("../lib/blitz-figure-context.ts", "FIGURE_PATTERNS")).toBe(
      extract("../lib/kb-review-risk.ts", "NUMBER_PATTERNS"),
    );
  });
});
