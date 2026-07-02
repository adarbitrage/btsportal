import { describe, it, expect } from "vitest";
import { rebrandOldBrandContent } from "../lib/content-privacy-filter";

/**
 * Unit coverage for the old-brand backfill's core transform
 * (rebrandOldBrandContent). The DB-driven wrapper
 * (rebrand-old-brand-source-content.ts) is a thin loop over this function that
 * only writes rows whose value actually changed, so verifying the transform's
 * rewrite / no-op / idempotency behaviour here covers the backfill's contract
 * without needing a live database.
 */
describe("rebrandOldBrandContent (old-brand source backfill)", () => {
  it("rebrands the company name to BTS", () => {
    expect(rebrandOldBrandContent("We ran ads for Cherrington Media.")).toBe(
      "We ran ads for BTS.",
    );
  });

  it("rebrands 'The Cherrington Experience' to BTS", () => {
    expect(
      rebrandOldBrandContent("Welcome to The Cherrington Experience program."),
    ).toBe("Welcome to BTS program.");
  });

  it("reduces the founder's full name to the first name only", () => {
    expect(rebrandOldBrandContent("A note from Adam Cherrington.")).toBe(
      "A note from Adam.",
    );
  });

  it("rebrands the TCE acronym to BTS", () => {
    expect(rebrandOldBrandContent("Joining TCE was the best move.")).toBe(
      "Joining BTS was the best move.",
    );
  });

  it("rebrands the garbled 'Cherring method' variant to BTS", () => {
    expect(rebrandOldBrandContent("He taught the Cherring method here.")).toBe(
      "He taught the BTS here.",
    );
  });

  it("rewrites every old-brand form in one pass", () => {
    const input =
      "Adam Cherrington built Cherrington Media, aka TCE / The Cherrington Experience, using the Cherring method.";
    const out = rebrandOldBrandContent(input);
    expect(out).not.toMatch(/Ch[ae]rring/i);
    expect(out).not.toMatch(/\bTCE\b/);
    expect(out).toContain("BTS");
    expect(out).toContain("Adam ");
  });

  it("leaves clean content untouched, byte-for-byte (incl. double spaces)", () => {
    const clean = "Build a landing page,  test the offer, then scale spend.";
    expect(rebrandOldBrandContent(clean)).toBe(clean);
  });

  it("preserves coach / VA names (old-brand only, not the full privacy filter)", () => {
    const input = "Coach Sasha Bobylev reviewed the Cherrington Media account.";
    expect(rebrandOldBrandContent(input)).toBe(
      "Coach Sasha Bobylev reviewed the BTS account.",
    );
  });

  it("is idempotent — a second pass makes no further change", () => {
    const input =
      "Adam Cherrington ran Cherrington Media (TCE) via the Cherring method.";
    const once = rebrandOldBrandContent(input);
    expect(rebrandOldBrandContent(once)).toBe(once);
  });

  it("returns an empty string for nullish input", () => {
    expect(rebrandOldBrandContent(null)).toBe("");
    expect(rebrandOldBrandContent(undefined)).toBe("");
    expect(rebrandOldBrandContent("")).toBe("");
  });
});
