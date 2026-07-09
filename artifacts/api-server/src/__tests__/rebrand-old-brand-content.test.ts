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

describe("21 Day Blitz -> the Blitz rename", () => {
  it("converts representative day-count variants to 'the Blitz'", () => {
    expect(rebrandOldBrandContent("Start the 21 Day Blitz today.")).toBe(
      "Start the Blitz today.",
    );
    expect(rebrandOldBrandContent("Enroll in the 21-day Blitz program.")).toBe(
      "Enroll in the Blitz program.",
    );
    expect(rebrandOldBrandContent("the 21day blitz teaches scaling")).toBe(
      "the Blitz teaches scaling",
    );
    expect(rebrandOldBrandContent("What is 21 Day Blitz?")).toBe("What is the Blitz?");
    expect(rebrandOldBrandContent("21 DAY BLITZ overview")).toBe("the Blitz overview");
  });

  it("never produces a double 'the the Blitz' artifact", () => {
    const out = rebrandOldBrandContent("Welcome to The 21 Day Blitz and the 21-day blitz.");
    expect(out).not.toMatch(/the the/i);
    expect(out).toBe("Welcome to The Blitz and the Blitz.");
  });

  it("leaves the yse_21_day_blitz identifier untouched", () => {
    expect(rebrandOldBrandContent("slug: yse_21_day_blitz")).toBe("slug: yse_21_day_blitz");
  });

  it("leaves the real external product name 'YSE 21-Day Blitz' untouched", () => {
    expect(rebrandOldBrandContent('The product "YSE 21-Day Blitz ($297)" is external.')).toBe(
      'The product "YSE 21-Day Blitz ($297)" is external.',
    );
  });

  it("is idempotent for the Blitz rename", () => {
    const once = rebrandOldBrandContent("Join the 21 Day Blitz now");
    expect(rebrandOldBrandContent(once)).toBe(once);
  });
});
