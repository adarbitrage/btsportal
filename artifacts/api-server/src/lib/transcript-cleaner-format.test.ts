// Cleaner output format contract (Task #1746): the canonical cleaned-call
// layout is a BARE speaker label on its own line. Any inline colon-dialogue
// drift ("Coach: text Member: text …") is deterministically normalized back to
// bare-label turns before saving, and an unnormalizable residual FAILS LOUDLY
// (CleanerFormatError) instead of being persisted. Pure tests: no network, no DB.
import { describe, expect, it } from "vitest";

import {
  CleanerFormatError,
  enforceCleanerFormatContract,
  normalizeCleanedTranscriptFormat,
} from "./transcript-cleaner";

const CANONICAL = [
  "Coach:",
  "Welcome back, let's look at your campaign.",
  "",
  "Member:",
  "I paused it because the ROI dropped.",
  "",
  "Coach:",
  "Good instinct. Now let's check the offer angle.",
].join("\n");

describe("normalizeCleanedTranscriptFormat", () => {
  it("passes an already-canonical transcript through unchanged (idempotent)", () => {
    const r = normalizeCleanedTranscriptFormat(CANONICAL);
    expect(r.text).toBe(CANONICAL);
    expect(r.convertedLabels).toBe(0);
    // Idempotency on its own output.
    const again = normalizeCleanedTranscriptFormat(r.text);
    expect(again.text).toBe(r.text);
    expect(again.convertedLabels).toBe(0);
  });

  it("splits a glued inline-label stretch into canonical bare-label turns", () => {
    const glued =
      "Coach: Let's review your funnel. Member: The landing page converts at two percent. Coach: That's workable, raise the bid.";
    const r = normalizeCleanedTranscriptFormat(glued);
    expect(r.convertedLabels).toBe(3);
    const lines = r.text.split("\n");
    expect(lines).toContain("Coach:");
    expect(lines).toContain("Member:");
    // Same words, same order — no rewording.
    expect(r.text).toContain("Let's review your funnel.");
    expect(r.text).toContain("The landing page converts at two percent.");
    expect(r.text).toContain("That's workable, raise the bid.");
    expect(r.text.indexOf("funnel")).toBeLessThan(r.text.indexOf("two percent"));
    // No inline label followed by same-line text remains.
    for (const line of lines) {
      expect(/^(Coach|Member|VA):\s*\S/.test(line)).toBe(false);
    }
  });

  it("repairs a mid-document drift while leaving the canonical part untouched", () => {
    const mixed = `${CANONICAL}\n\nMember: What about budget? Coach: Keep tests small. Member: Got it.`;
    const r = normalizeCleanedTranscriptFormat(mixed);
    expect(r.convertedLabels).toBe(3);
    expect(r.text.startsWith(CANONICAL)).toBe(true);
  });

  it("handles VA labels and preserves pre-label continuation text", () => {
    const glued = "and that wraps setup. VA: I finished the listings. Member: Great work. VA: Anything else?";
    const r = normalizeCleanedTranscriptFormat(glued);
    expect(r.convertedLabels).toBe(3);
    const lines = r.text.split("\n");
    expect(lines[0]).toBe("and that wraps setup.");
    expect(lines).toContain("VA:");
    expect(lines).toContain("Member:");
  });

  it("leaves non-canonical colon text (times, URLs, ordinary prose) alone", () => {
    const text = ["Coach:", "Meet me at 10:30. See https://example.com: the docs page. Note: bring numbers."].join("\n");
    const r = normalizeCleanedTranscriptFormat(text);
    expect(r.text).toBe(text);
    expect(r.convertedLabels).toBe(0);
  });
});

describe("enforceCleanerFormatContract", () => {
  it("returns the normalized text for a repairable drift", () => {
    const glued = "Coach: First point. Member: A question? Coach: The answer.";
    const r = enforceCleanerFormatContract(glued);
    expect(r.convertedLabels).toBe(3);
    expect(r.text.split("\n")).toContain("Coach:");
  });

  it("throws CleanerFormatError on a residual the converter cannot fix (loose spacing)", () => {
    // "Coach :" (space before the colon) is caught by the broader residual
    // detector but deliberately NOT handled by the tight converter.
    const odd = ["Coach:", "Intro line.", "", "Coach : still inline text after a spaced colon"].join("\n");
    expect(() => enforceCleanerFormatContract(odd)).toThrow(CleanerFormatError);
  });

  it("accepts a fully canonical transcript without changes", () => {
    const r = enforceCleanerFormatContract(CANONICAL);
    expect(r.text).toBe(CANONICAL);
    expect(r.convertedLabels).toBe(0);
  });
});
