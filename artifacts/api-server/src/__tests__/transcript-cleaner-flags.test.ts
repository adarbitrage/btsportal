import { describe, it, expect } from "vitest";
import {
  mapModelFlags,
  applyRefineEdits,
  splitTranscriptForCleaning,
  dedupeFlags,
  assembleTranscriptTitle,
  normalizeIsoDate,
  memberNameFromSourceName,
  titleFollowsGrammar,
  detectRosterAuthority,
} from "../lib/transcript-cleaner";
import { resolveSourceFolder } from "../lib/kb-taxonomy";

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

describe("splitTranscriptForCleaning (big-file chunking)", () => {
  it("returns the whole text as one chunk when at/under the threshold", () => {
    const small = "Coach: hi\nMember 1: hello";
    expect(splitTranscriptForCleaning(small)).toEqual([small]);
  });

  it("splits a SINGLE newline-free line (the real export shape) into multiple chunks", () => {
    // The stored transcripts are one giant line with zero newlines — a
    // line-only splitter would never break these. Build a 1-line, ~3k-char
    // transcript and split with a small target.
    const sentence = "The coach explains the funnel step in detail here. ";
    const text = sentence.repeat(60).trim(); // ~3000 chars, no newlines
    const chunks = splitTranscriptForCleaning(text, { threshold: 500, target: 600 });
    expect(chunks.length).toBeGreaterThan(1);
    // Loss-less by construction: slices concatenate back to the original.
    expect(chunks.join("")).toBe(text);
    // Every chunk respects the target bound.
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(600);
  });

  it("prefers newline > sentence > space boundaries when slicing", () => {
    const para = "First paragraph sentence one. Second sentence two.\n";
    const text = para.repeat(40); // mixed newlines, sentences, spaces
    const chunks = splitTranscriptForCleaning(text, { threshold: 200, target: 250 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
    // Most cuts should land just after a boundary char, not mid-word.
    for (const chunk of chunks.slice(0, -1)) {
      const last = chunk[chunk.length - 1];
      expect(["\n", " "]).toContain(last);
    }
  });

  it("hard-cuts a boundary-free blob at the target rather than overflowing", () => {
    const text = "x".repeat(1000); // no spaces or newlines anywhere
    const chunks = splitTranscriptForCleaning(text, { threshold: 100, target: 150 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(150);
  });

  it("always makes forward progress (no empty/zero-length chunks)", () => {
    const text = "word ".repeat(500);
    const chunks = splitTranscriptForCleaning(text, { threshold: 100, target: 120 });
    for (const chunk of chunks) expect(chunk.length).toBeGreaterThan(0);
    expect(chunks.join("")).toBe(text);
  });
});

describe("dedupeFlags (chunk stitch)", () => {
  it("removes exact-duplicate flags but keeps distinct ones", () => {
    const deduped = dedupeFlags([
      { type: "garbled_content", text: "abc", reason: "unrecoverable", confidence: "low" },
      { type: "garbled_content", text: "abc", reason: "unrecoverable", confidence: "low" },
      { type: "uncertain_authority", reason: "who teaches?", confidence: "low" },
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((f) => f.type)).toEqual(["garbled_content", "uncertain_authority"]);
  });

  it("treats different text/reason as distinct", () => {
    const deduped = dedupeFlags([
      { type: "garbled_content", text: "abc", reason: "r1", confidence: "low" },
      { type: "garbled_content", text: "abc", reason: "r2", confidence: "low" },
    ]);
    expect(deduped).toHaveLength(2);
  });
});

describe("normalizeIsoDate", () => {
  it("accepts a real ISO date and round-trips it", () => {
    expect(normalizeIsoDate("2025-01-14")).toBe("2025-01-14");
    expect(normalizeIsoDate("recorded 2024-12-31 evening")).toBe("2024-12-31");
  });

  it("rejects impossible / malformed dates (never fabricates)", () => {
    expect(normalizeIsoDate("2025-13-01")).toBeNull(); // month 13
    expect(normalizeIsoDate("2025-02-30")).toBeNull(); // Feb 30
    expect(normalizeIsoDate("01/14/2025")).toBeNull(); // not ISO
    expect(normalizeIsoDate("")).toBeNull();
    expect(normalizeIsoDate(null)).toBeNull();
    expect(normalizeIsoDate(undefined)).toBeNull();
    expect(normalizeIsoDate(20250114)).toBeNull();
  });
});

describe("memberNameFromSourceName", () => {
  it("strips meeting-export suffixes", () => {
    expect(memberNameFromSourceName("Adam Field Meeting Information")).toBe("Adam Field");
    expect(memberNameFromSourceName("Jane Doe Meeting Notes")).toBe("Jane Doe");
  });

  it("strips trailing dash descriptors and duplicate-import markers", () => {
    expect(memberNameFromSourceName("Donald Hayes - Mitolyn")).toBe("Donald Hayes");
    expect(memberNameFromSourceName("Donald Hayes - Mitolyn(1)")).toBe("Donald Hayes");
  });

  it("leaves a bare name untouched", () => {
    expect(memberNameFromSourceName("Cheryl L Rodriguez")).toBe("Cheryl L Rodriguez");
    expect(memberNameFromSourceName(null)).toBe("");
    expect(memberNameFromSourceName(undefined)).toBe("");
  });
});

describe("titleFollowsGrammar", () => {
  it("recognises a conforming title", () => {
    expect(titleFollowsGrammar("Private Coaching — Adam Field (Coach Sasha)")).toBe(true);
    expect(titleFollowsGrammar("1-on-1 VA — Donald Hayes (VA John)")).toBe(true);
    expect(titleFollowsGrammar("Doc — Refund Policy")).toBe(true);
  });

  it("rejects a non-conforming / empty title", () => {
    expect(titleFollowsGrammar("Cheryl L Rodriguez")).toBe(false);
    expect(titleFollowsGrammar("")).toBe(false);
    expect(titleFollowsGrammar(null)).toBe(false);
  });

  it("is slug-aware: a 1-on-1 title missing its (Coach …) authority is rejected", () => {
    const pc = resolveSourceFolder("private_coaching");
    const va = resolveSourceFolder("one_on_one_va");
    // Authority-less 1-on-1 titles look prefix-valid but fail the slug grammar.
    expect(titleFollowsGrammar("Private Coaching — Cheryl L Rodriguez", pc)).toBe(false);
    expect(titleFollowsGrammar("1-on-1 VA — Donald Hayes", va)).toBe(false);
    // Fully-formed titles pass under their slug.
    expect(
      titleFollowsGrammar("Private Coaching — Adam Field (Coach Sasha) — 2025-01-14", pc),
    ).toBe(true);
    expect(titleFollowsGrammar("1-on-1 VA — Donald Hayes (VA John)", va)).toBe(true);
    // A title under the WRONG slug is rejected.
    expect(titleFollowsGrammar("Doc — Refund Policy", pc)).toBe(false);
  });
});

describe("assembleTranscriptTitle (type-specific grammar, Task #1518)", () => {
  const folder = (slug: string) => resolveSourceFolder(slug);

  it("private coaching: member (Coach) with optional date", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("private_coaching"),
        authorityRole: "strategic_coach",
        authorityName: "bruce",
        primarySubject: "Cheryl L Rodriguez",
        sourceName: "Cheryl L Rodriguez",
        isoDate: null,
      }),
    ).toEqual({ title: "Private Coaching — Cheryl L Rodriguez (Coach Bruce)", titleNeedsInput: false });

    expect(
      assembleTranscriptTitle({
        folder: folder("private_coaching"),
        authorityRole: "strategic_coach",
        authorityName: "Sasha",
        primarySubject: "Adam Field",
        sourceName: null,
        isoDate: "2025-01-14",
      }),
    ).toEqual({ title: "Private Coaching — Adam Field (Coach Sasha) — 2025-01-14", titleNeedsInput: false });
  });

  it("1-on-1 VA: member (VA) and falls back to the source filename for the member", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("one_on_one_va"),
        authorityRole: "va",
        authorityName: "John",
        primarySubject: null,
        sourceName: "Donald Hayes - Mitolyn",
        isoDate: null,
      }),
    ).toEqual({ title: "1-on-1 VA — Donald Hayes (VA John)", titleNeedsInput: false });
  });

  it("1-on-1 with an unrecoverable member → blank title + titleNeedsInput", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("private_coaching"),
        authorityRole: "strategic_coach",
        authorityName: "Bruce",
        primarySubject: null,
        sourceName: null,
        isoDate: null,
      }),
    ).toEqual({ title: "", titleNeedsInput: true });
  });

  it("1-on-1 with an unrecoverable authority → blank title + titleNeedsInput (never authority-less)", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("private_coaching"),
        authorityRole: "strategic_coach",
        authorityName: null,
        primarySubject: "Cheryl L Rodriguez",
        sourceName: "Cheryl L Rodriguez",
        isoDate: null,
      }),
    ).toEqual({ title: "", titleNeedsInput: true });
  });

  it("group coaching: coach only, no member subject", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("group_coaching"),
        authorityRole: "strategic_coach",
        authorityName: "Michael",
        primarySubject: null,
        sourceName: "Live Coaching Call - Michael",
        isoDate: "2025-02-03",
      }),
    ).toEqual({ title: "Group Coaching — Coach Michael — 2025-02-03", titleNeedsInput: false });
  });

  it("group coaching with no coach name → blank + titleNeedsInput", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("group_coaching"),
        authorityRole: "strategic_coach",
        authorityName: null,
        primarySubject: null,
        sourceName: "Live Coaching Call",
        isoDate: null,
      }),
    ).toEqual({ title: "", titleNeedsInput: true });
  });

  it("blitz video: topic only, never a date", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("blitz_video"),
        authorityRole: "curriculum",
        authorityName: null,
        primarySubject: "Setting Up DIYTrax",
        sourceName: null,
        isoDate: "2025-01-14",
      }),
    ).toEqual({ title: "Blitz Video — Setting Up DIYTrax", titleNeedsInput: false });
  });

  it("other video: topic with optional date", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("other_video"),
        authorityRole: "internal",
        authorityName: null,
        primarySubject: "Platform Walkthrough",
        sourceName: null,
        isoDate: "2025-03-09",
      }),
    ).toEqual({ title: "Other Video — Platform Walkthrough — 2025-03-09", titleNeedsInput: false });
  });

  it("reference / other docs: 'Reference' & 'Doc' prefixes, never a date", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("reference_docs"),
        authorityRole: "internal",
        authorityName: null,
        primarySubject: "Commission Structure",
        sourceName: null,
        isoDate: "2025-03-09",
      }),
    ).toEqual({ title: "Reference — Commission Structure", titleNeedsInput: false });

    expect(
      assembleTranscriptTitle({
        folder: folder("other_docs"),
        authorityRole: "internal",
        authorityName: null,
        primarySubject: "Refund Policy",
        sourceName: null,
        isoDate: null,
      }),
    ).toEqual({ title: "Doc — Refund Policy", titleNeedsInput: false });
  });

  it("video/doc with no topic → blank + titleNeedsInput", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("other_docs"),
        authorityRole: "internal",
        authorityName: null,
        primarySubject: null,
        sourceName: null,
        isoDate: null,
      }),
    ).toEqual({ title: "", titleNeedsInput: true });
  });
});

describe("detectRosterAuthority (inline speaker labels)", () => {
  const roster = new Map<string, string>([
    ["bruce", "strategic_coach"],
    ["sasha", "strategic_coach"],
  ]);

  it("detects a colon label that appears INLINE in a single newline-free line", () => {
    // The real export shape: the whole transcript is one line, so "Bruce:" never
    // sits at a line start. The colon still marks it as the speaker/authority.
    const text =
      "Cheryl L Rodriguez Bruce: Hey, Cheryl. Cheryl Blair: Hi, Bruce, how are you? Bruce: Good.";
    const hit = detectRosterAuthority(text, roster);
    expect(hit.labelMatched).toEqual([{ name: "bruce", role: "strategic_coach" }]);
  });

  it("still detects a classic line-start label", () => {
    const hit = detectRosterAuthority("Bruce: hello\nMember 1: hi", roster);
    expect(hit.labelMatched.map((m) => m.name)).toEqual(["bruce"]);
  });

  it("does NOT promote a bare mid-sentence mention (no delimiter) to authority", () => {
    const hit = detectRosterAuthority("The member said they spoke with Bruce last week.", roster);
    expect(hit.labelMatched).toEqual([]);
    expect(hit.inlineOnly).toContain("bruce");
  });

  it("does not match a name embedded in a larger word", () => {
    const hit = detectRosterAuthority("This is abruce: not a label", roster);
    expect(hit.labelMatched).toEqual([]);
  });
});
