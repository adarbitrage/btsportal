import { describe, it, expect } from "vitest";
import {
  mapModelFlags,
  applyRefineEdits,
  splitTranscriptForCleaning,
  dedupeFlags,
  assembleTranscriptTitle,
  normalizeIsoDate,
  memberNameFromSourceName,
  parseVaTranscriptFilename,
  applyVaFilenameAutofill,
  type VaAutofillFields,
  titleFollowsGrammar,
  coachOnlyPrivateCoachingTitle,
  detectRosterAuthority,
  extractJson,
  parseCleanerReply,
  repairJsonStringLiterals,
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

  it("accepts the YYYY/MM/DD slash shape (VA filenames) and normalises to dashes", () => {
    expect(normalizeIsoDate("2026/03/28")).toBe("2026-03-28");
    expect(normalizeIsoDate("2026/03/28 01:27 PST")).toBe("2026-03-28");
    expect(normalizeIsoDate("2025/13/01")).toBeNull(); // month 13, slash form
  });

  it("rejects impossible / malformed dates (never fabricates)", () => {
    expect(normalizeIsoDate("2025-13-01")).toBeNull(); // month 13
    expect(normalizeIsoDate("2025-02-30")).toBeNull(); // Feb 30
    expect(normalizeIsoDate("01/14/2025")).toBeNull(); // not ISO (month-first)
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

describe("parseVaTranscriptFilename (Task #1675)", () => {
  it("extracts the issue type (segment 2) and the slash date, never the member", () => {
    expect(
      parseVaTranscriptFilename(
        "Stephanie Sharpe - Assistance Required - 2026/03/28 01:27 PST - Recording",
      ),
    ).toEqual({ issueType: "Assistance Required", isoDate: "2026-03-28" });
  });

  it("strips a path and file extension before parsing", () => {
    expect(
      parseVaTranscriptFilename(
        "uploads/Donald Hayes - Website Setup - 2026/01/05 12:00 EST - Recording.vtt",
      ),
    ).toEqual({ issueType: "Website Setup", isoDate: "2026-01-05" });
  });

  it("tolerates a missing date (issue type only)", () => {
    expect(parseVaTranscriptFilename("Jane Doe - Funnel Review - Recording")).toEqual({
      issueType: "Funnel Review",
      isoDate: null,
    });
  });

  it("does not treat a date or the 'Recording' marker as an issue type", () => {
    // Second segment is the date itself → no issue type, date still captured.
    expect(
      parseVaTranscriptFilename("Jane Doe - 2026/03/28 01:27 PST - Recording"),
    ).toEqual({ issueType: null, isoDate: "2026-03-28" });
  });

  it("returns null when there is no usable second segment or match", () => {
    expect(parseVaTranscriptFilename("Just A Member Name")).toBeNull();
    expect(parseVaTranscriptFilename("")).toBeNull();
    expect(parseVaTranscriptFilename(null)).toBeNull();
    expect(parseVaTranscriptFilename(undefined)).toBeNull();
    expect(parseVaTranscriptFilename(42)).toBeNull();
  });
});

describe("applyVaFilenameAutofill (Task #1675)", () => {
  it("fills blank Subject + Date for a VA upload from the filename", () => {
    const input: VaAutofillFields = {
      transcriptType: "one_on_one_va",
      sourceName: "Stephanie Sharpe - Assistance Required - 2026/03/28 01:27 PST - Recording",
    };
    const out = applyVaFilenameAutofill(input);
    expect(out.providedSubject).toBe("Assistance Required");
    expect(out.providedDate).toBe("2026-03-28");
  });

  it("never overrides an admin-provided Subject or Date", () => {
    const out = applyVaFilenameAutofill({
      transcriptType: "one_on_one_va",
      sourceName: "Stephanie Sharpe - Assistance Required - 2026/03/28 01:27 PST - Recording",
      providedSubject: "Manual Topic",
      providedDate: "2020-01-01",
    });
    expect(out.providedSubject).toBe("Manual Topic");
    expect(out.providedDate).toBe("2020-01-01");
  });

  it("only applies to VA uploads (leaves other call types untouched)", () => {
    const input = {
      transcriptType: "private_coaching",
      sourceName: "Stephanie Sharpe - Assistance Required - 2026/03/28 01:27 PST - Recording",
    };
    expect(applyVaFilenameAutofill(input)).toEqual(input);
  });

  it("leaves a VA upload untouched when the filename does not match", () => {
    const input = { transcriptType: "one_on_one_va", sourceName: "Just A Member Name" };
    expect(applyVaFilenameAutofill(input)).toEqual(input);
  });
});

describe("titleFollowsGrammar", () => {
  it("recognises a conforming title", () => {
    expect(titleFollowsGrammar("Private Coaching — Coach Sasha")).toBe(true);
    expect(titleFollowsGrammar("1-on-1 VA — Donald Hayes (VA John)")).toBe(true);
    expect(titleFollowsGrammar("Doc — Refund Policy")).toBe(true);
  });

  it("rejects a non-conforming / empty title", () => {
    expect(titleFollowsGrammar("Cheryl L Rodriguez")).toBe(false);
    expect(titleFollowsGrammar("")).toBe(false);
    expect(titleFollowsGrammar(null)).toBe(false);
  });

  it("is slug-aware: rejects old member-bearing private coaching + authority-less VA titles", () => {
    const pc = resolveSourceFolder("private_coaching");
    const va = resolveSourceFolder("one_on_one_va");
    // Old member-bearing private coaching titles are now NON-conforming (Task
    // #1667) so the backfill recognises them as stale and rewrites them to the
    // coach-only shape.
    expect(
      titleFollowsGrammar("Private Coaching — Adam Field (Coach Sasha) — 2025-01-14", pc),
    ).toBe(false);
    expect(titleFollowsGrammar("Private Coaching — Cheryl L Rodriguez", pc)).toBe(false);
    // New coach-only private coaching titles are compliant (idempotent no-op).
    expect(titleFollowsGrammar("Private Coaching — Coach Sasha — 2025-01-14", pc)).toBe(true);
    expect(titleFollowsGrammar("Private Coaching — Coach", pc)).toBe(true);
    // Old member-bearing 1-on-1 VA titles (trailing `(VA …)`) are now stale (Task
    // #1675) so the backfill rewrites them to the issue-type shape.
    expect(titleFollowsGrammar("1-on-1 VA — Donald Hayes (VA John)", va)).toBe(false);
    expect(titleFollowsGrammar("1-on-1 VA — Donald Hayes (VA John) — 2026-03-28", va)).toBe(false);
    // New issue-type 1-on-1 VA titles are compliant (idempotent no-op), with and
    // without the leading VA parenthetical, with and without a date.
    expect(titleFollowsGrammar("1-on-1 VA (VA John) — Assistance Required — 2026-03-28", va)).toBe(true);
    expect(titleFollowsGrammar("1-on-1 VA — Assistance Required — 2026-03-28", va)).toBe(true);
    expect(titleFollowsGrammar("1-on-1 VA (VA John) — Assistance Required", va)).toBe(true);
    expect(titleFollowsGrammar("1-on-1 VA — Website Setup", va)).toBe(true);
    // A title under the WRONG slug is rejected.
    expect(titleFollowsGrammar("Doc — Refund Policy", pc)).toBe(false);
  });
});

describe("coachOnlyPrivateCoachingTitle (filed-transcript backfill, Task #1668)", () => {
  it("drops the member name from an old member-bearing title", () => {
    expect(
      coachOnlyPrivateCoachingTitle("Private Coaching — Adam Field (Coach Sasha) — 2025-01-14"),
    ).toBe("Private Coaching — Coach Sasha — 2025-01-14");
    // No trailing date.
    expect(
      coachOnlyPrivateCoachingTitle("Private Coaching — Cheryl L Rodriguez (Coach Bruce)"),
    ).toBe("Private Coaching — Coach Bruce");
    // Bare authority (no coach name) still drops the member.
    expect(
      coachOnlyPrivateCoachingTitle("Private Coaching — Adam Field (Coach)"),
    ).toBe("Private Coaching — Coach");
    // VA authority is preserved.
    expect(
      coachOnlyPrivateCoachingTitle("Private Coaching — Adam Field (VA John) — 2025-03-02"),
    ).toBe("Private Coaching — VA John — 2025-03-02");
  });

  it("is idempotent: leaves already coach-only titles untouched", () => {
    expect(coachOnlyPrivateCoachingTitle("Private Coaching — Coach Sasha — 2025-01-14")).toBeNull();
    expect(coachOnlyPrivateCoachingTitle("Private Coaching — Coach")).toBeNull();
    expect(coachOnlyPrivateCoachingTitle("Private Coaching — VA John")).toBeNull();
  });

  it("leaves other / hand-edited / non-private titles untouched", () => {
    // A private coaching title in some other shape (can't safely locate member).
    expect(coachOnlyPrivateCoachingTitle("Private Coaching — Cheryl L Rodriguez")).toBeNull();
    expect(coachOnlyPrivateCoachingTitle("Q1 Strategy Deep-Dive")).toBeNull();
    // Other call types are never touched by this private-coaching-only backfill.
    expect(coachOnlyPrivateCoachingTitle("1-on-1 VA — Donald Hayes (VA John)")).toBeNull();
    expect(coachOnlyPrivateCoachingTitle("Group Coaching — Coach Sasha")).toBeNull();
    expect(coachOnlyPrivateCoachingTitle("")).toBeNull();
    expect(coachOnlyPrivateCoachingTitle(null)).toBeNull();
  });
});

describe("assembleTranscriptTitle (type-specific grammar, Task #1518)", () => {
  const folder = (slug: string) => resolveSourceFolder(slug);

  it("private coaching: coach only, no member subject, with optional date (Task #1667)", () => {
    // The member name must NOT appear — even when a member/source is supplied.
    expect(
      assembleTranscriptTitle({
        folder: folder("private_coaching"),
        authorityRole: "strategic_coach",
        authorityName: "bruce",
        primarySubject: "Cheryl L Rodriguez",
        sourceName: "Cheryl L Rodriguez",
        isoDate: null,
      }),
    ).toEqual({ title: "Private Coaching — Coach Bruce", titleNeedsInput: false });

    expect(
      assembleTranscriptTitle({
        folder: folder("private_coaching"),
        authorityRole: "strategic_coach",
        authorityName: "Sasha",
        primarySubject: "Adam Field",
        sourceName: null,
        isoDate: "2025-01-14",
      }),
    ).toEqual({ title: "Private Coaching — Coach Sasha — 2025-01-14", titleNeedsInput: false });
  });

  it("private coaching with no coach name → bare 'Coach' fallback (req 9), still titled", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("private_coaching"),
        authorityRole: "strategic_coach",
        authorityName: null,
        primarySubject: null,
        sourceName: null,
        isoDate: null,
      }),
    ).toEqual({ title: "Private Coaching — Coach", titleNeedsInput: false });
  });

  it("private coaching never blanks — the member is irrelevant to the coach-only title", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("private_coaching"),
        authorityRole: "strategic_coach",
        authorityName: "Bruce",
        primarySubject: null,
        sourceName: null,
        isoDate: "2025-01-14",
      }),
    ).toEqual({ title: "Private Coaching — Coach Bruce — 2025-01-14", titleNeedsInput: false });
  });

  it("1-on-1 VA: issue-type subject with a LEADING VA parenthetical + date (Task #1675)", () => {
    // The member name must NOT appear — the subject is the issue type, the VA
    // name renders in a leading parenthetical, and the date is appended.
    expect(
      assembleTranscriptTitle({
        folder: folder("one_on_one_va"),
        authorityRole: "va",
        authorityName: "John",
        primarySubject: "Assistance Required",
        sourceName: "Stephanie Sharpe - Assistance Required - 2026/03/28 01:27 PST - Recording",
        isoDate: "2026-03-28",
      }),
    ).toEqual({
      title: "1-on-1 VA (VA John) — Assistance Required — 2026-03-28",
      titleNeedsInput: false,
    });
  });

  it("1-on-1 VA with no VA name → the parenthetical is OMITTED entirely (never bare 'VA')", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("one_on_one_va"),
        authorityRole: "va",
        authorityName: null,
        primarySubject: "Website Setup",
        sourceName: "Donald Hayes - Website Setup - 2026/01/05 - Recording",
        isoDate: null,
      }),
    ).toEqual({ title: "1-on-1 VA — Website Setup", titleNeedsInput: false });
  });

  it("1-on-1 VA with an unrecoverable issue type → blank title + titleNeedsInput", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("one_on_one_va"),
        authorityRole: "va",
        authorityName: "John",
        primarySubject: null,
        sourceName: null,
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

  it("group coaching with no coach name → bare 'Coach' fallback (req 9), still titled", () => {
    expect(
      assembleTranscriptTitle({
        folder: folder("group_coaching"),
        authorityRole: "strategic_coach",
        authorityName: null,
        primarySubject: null,
        sourceName: "Live Coaching Call",
        isoDate: null,
      }),
    ).toEqual({ title: "Group Coaching — Coach", titleNeedsInput: false });
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

describe("JSON recovery (Task #1616 — smart-quote-heavy replies)", () => {
  it("parses already-valid JSON unchanged on the first try", () => {
    const obj = { authority: { label: "Coach", confidence: "high" }, flags: [] };
    expect(extractJson(JSON.stringify(obj))).toEqual(obj);
  });

  it("repairs UNESCAPED inner double-quotes inside a string value", () => {
    // The exact failure mode: a big value with a raw `"` mid-string.
    const broken = '{"cleanedTranscript": "He said "let\'s go" and left", "flags": []}';
    const parsed = extractJson(broken);
    expect(parsed.cleanedTranscript).toBe('He said "let\'s go" and left');
    expect(parsed.flags).toEqual([]);
  });

  it("repairs RAW control characters (newlines/tabs) inside a string value", () => {
    const broken = '{"cleanedTranscript": "Coach: hello\nMember: hi\tthere", "flags": []}';
    const parsed = extractJson(broken);
    expect(parsed.cleanedTranscript).toBe("Coach: hello\nMember: hi\tthere");
  });

  it("still repairs trailing commas", () => {
    expect(extractJson('{"a": 1, "b": [1, 2,], }')).toEqual({ a: 1, b: [1, 2] });
  });

  it("tolerates ``` fences around the JSON", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("throws a no-JSON error when the reply has no object", () => {
    expect(() => extractJson("sorry, I cannot help with that")).toThrow(/did not contain a JSON object/i);
  });

  it("repairJsonStringLiterals leaves already-valid JSON byte-for-byte unchanged", () => {
    const valid = '{"a": "plain value", "b": [1, 2], "c": {"d": "x"}}';
    expect(repairJsonStringLiterals(valid)).toBe(valid);
  });
});

describe("parseCleanerReply (Task #1616 — delimited plain-text body)", () => {
  const OPEN = "===BEGIN CLEANED TRANSCRIPT===";
  const CLOSE = "===END CLEANED TRANSCRIPT===";

  it("extracts the transcript VERBATIM from the delimited block (no JSON escaping)", () => {
    // Smart quotes, straight quotes, ellipsis, apostrophes — the content that
    // deterministically corrupted the old single-JSON-string contract.
    const body = 'Coach: “Let’s begin,” he said… "really".\nMember: I don\'t know—maybe?';
    const reply = [
      '{"authority": {"label": "Coach", "confidence": "high"}, "primarySubject": "Jane Doe", "detectedDate": null, "flags": []}',
      "",
      OPEN,
      body,
      CLOSE,
    ].join("\n");
    const parsed = parseCleanerReply(reply);
    expect(parsed.cleanedTranscript).toBe(body);
    expect(parsed.authority.label).toBe("Coach");
    expect(parsed.primarySubject).toBe("Jane Doe");
    expect(parsed.flags).toEqual([]);
  });

  it("is unfazed by braces/quotes INSIDE the transcript body", () => {
    const body = 'Coach: The config was {"key": "value"} — note the quotes "here".';
    const reply = ['{"flags": [], "authority": {}}', OPEN, body, CLOSE].join("\n");
    const parsed = parseCleanerReply(reply);
    expect(parsed.cleanedTranscript).toBe(body);
    expect(parsed.flags).toEqual([]);
  });

  it("falls back to hardened extractJson when the markers are absent", () => {
    // Legacy/no-marker shape with an unescaped inner quote still recovers.
    const reply = '{"cleanedTranscript": "He said "hi" today", "flags": []}';
    const parsed = parseCleanerReply(reply);
    expect(parsed.cleanedTranscript).toBe('He said "hi" today');
  });

  it("reads metadata that appears AFTER the body block too", () => {
    const body = "Coach: hello\nMember: hi";
    const reply = [OPEN, body, CLOSE, '{"flags": [], "primarySubject": "Topic"}'].join("\n");
    const parsed = parseCleanerReply(reply);
    expect(parsed.cleanedTranscript).toBe(body);
    expect(parsed.primarySubject).toBe("Topic");
  });
});
