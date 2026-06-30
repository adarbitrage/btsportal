import { describe, it, expect } from "vitest";
import { mapModelFlags } from "../lib/transcript-cleaner";

describe("transcript cleaner flag contract", () => {
  it("keeps the two contract flag types", () => {
    const flags = mapModelFlags([
      { type: "garbled_content", text: "...", reason: "unrecoverable" },
      { type: "uncertain_authority", reason: "cannot tell who teaches" },
    ]);
    expect(flags.map((f) => f.type)).toEqual([
      "garbled_content",
      "uncertain_authority",
    ]);
  });

  it("drops off-contract / invented flag types (the noise we suppress)", () => {
    const flags = mapModelFlags([
      { type: "uncertain_term", reason: "unfamiliar proper noun" },
      { type: "title_date", reason: "missing date" },
      { type: "low_confidence_spelling", reason: "typo" },
      { type: "general", reason: "cosmetic" },
    ]);
    expect(flags).toHaveLength(0);
  });

  it("coerces near-miss type names onto the allowlist", () => {
    const flags = mapModelFlags([
      { type: "garbled_text", reason: "scrambled" },
      { type: "low_confidence_attribution", reason: "who said it?" },
      { type: "speaker_ambiguous", reason: "ambiguous speaker" },
    ]);
    expect(flags.map((f) => f.type)).toEqual([
      "garbled_content",
      "uncertain_authority",
      "uncertain_authority",
    ]);
  });

  it("defaults reason/confidence and tolerates junk entries", () => {
    const flags = mapModelFlags([
      { type: "garbled_content" },
      null,
      "nope",
      42,
      {},
    ]);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      type: "garbled_content",
      reason: "Flagged for review",
      confidence: "low",
    });
  });

  it("returns [] for non-array input", () => {
    expect(mapModelFlags(undefined)).toEqual([]);
    expect(mapModelFlags(null)).toEqual([]);
    expect(mapModelFlags("flags")).toEqual([]);
  });
});
