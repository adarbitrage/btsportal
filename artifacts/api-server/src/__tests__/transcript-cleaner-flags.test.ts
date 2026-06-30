import { describe, it, expect } from "vitest";
import { mapModelFlags, applyRefineEdits } from "../lib/transcript-cleaner";

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

describe("refine find/replace edits", () => {
  const transcript = "Coach: Welcome.\nMember 1: [garbled mumble] thanks.\nCoach: Let's begin.";

  it("applies a single unique deletion (the common flag-resolution case)", () => {
    const out = applyRefineEdits(transcript, [{ find: "[garbled mumble] ", replace: "" }]);
    expect(out).toBe("Coach: Welcome.\nMember 1: thanks.\nCoach: Let's begin.");
  });

  it("applies a single unique replacement", () => {
    const out = applyRefineEdits(transcript, [{ find: "[garbled mumble]", replace: "really" }]);
    expect(out).toBe("Coach: Welcome.\nMember 1: really thanks.\nCoach: Let's begin.");
  });

  it("replaces every occurrence only when all:true is set", () => {
    const out = applyRefineEdits(transcript, [{ find: "Coach:", replace: "Sasha:", all: true }]);
    expect(out).toBe("Sasha: Welcome.\nMember 1: [garbled mumble] thanks.\nSasha: Let's begin.");
  });

  it("falls back (null) when a non-all find matches more than once", () => {
    expect(applyRefineEdits(transcript, [{ find: "Coach:", replace: "Sasha:" }])).toBeNull();
  });

  it("falls back (null) when the find anchor is missing", () => {
    expect(applyRefineEdits(transcript, [{ find: "not in transcript", replace: "x" }])).toBeNull();
  });

  it("applies multiple edits in sequence", () => {
    const out = applyRefineEdits(transcript, [
      { find: "Welcome.", replace: "Hello." },
      { find: "Let's begin.", replace: "Let's start." },
    ]);
    expect(out).toBe("Coach: Hello.\nMember 1: [garbled mumble] thanks.\nCoach: Let's start.");
  });

  it("treats replacement text literally (no $ pattern interpretation)", () => {
    const out = applyRefineEdits("price was X here", [{ find: "X", replace: "$5 (was $10)" }]);
    expect(out).toBe("price was $5 (was $10) here");
  });

  it("treats an empty edits array as a no-op (returns transcript unchanged, no fallback)", () => {
    expect(applyRefineEdits(transcript, [])).toBe(transcript);
  });

  it("falls back (null) on missing/invalid edits", () => {
    expect(applyRefineEdits(transcript, undefined)).toBeNull();
    expect(applyRefineEdits(transcript, [{ find: "", replace: "x" }])).toBeNull();
    expect(applyRefineEdits(transcript, [{ find: "Coach:" }])).toBeNull();
    expect(applyRefineEdits(transcript, [null])).toBeNull();
  });
});
