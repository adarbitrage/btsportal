import { describe, it, expect } from "vitest";
import {
  normalizeForDedup,
  exactDedupHash,
  contentShingles,
  jaccardSimilarity,
  looksLikeQuestion,
  segmentExchanges,
  computeCalibrationVersion,
  effectiveDisposition,
  detectDuplicate,
} from "./kb-value-screener";
import { buildMemberPiiScrubber, parseMemberName } from "./kb-member-pii";

describe("normalizeForDedup / exactDedupHash", () => {
  it("normalizes casing, whitespace and punctuation to the same string", () => {
    expect(normalizeForDedup("Hello,   WORLD!!")).toBe("hello world");
    expect(normalizeForDedup("hello world")).toBe("hello world");
  });

  it("gives an identical exact hash for content differing only in casing/spacing", () => {
    const a = exactDedupHash("The Quick  Brown Fox.");
    const b = exactDedupHash("the quick brown fox");
    expect(a).toBe(b);
  });

  it("gives a different hash for genuinely different content", () => {
    expect(exactDedupHash("alpha beta")).not.toBe(exactDedupHash("gamma delta"));
  });
});

describe("shingles + jaccard", () => {
  it("produces 5-word shingles", () => {
    const s = contentShingles("one two three four five six", 5);
    expect(s.has("one two three four five")).toBe(true);
    expect(s.has("two three four five six")).toBe(true);
    expect(s.size).toBe(2);
  });

  it("handles short content (fewer words than the shingle size)", () => {
    const s = contentShingles("just three words", 5);
    expect(s.size).toBe(1);
    expect(s.has("just three words")).toBe(true);
  });

  it("computes jaccard similarity", () => {
    const a = new Set(["x", "y", "z"]);
    const b = new Set(["y", "z", "w"]);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(2 / 4);
    expect(jaccardSimilarity(a, a)).toBe(1);
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
    expect(jaccardSimilarity(a, new Set())).toBe(0);
  });

  it("scores highly-overlapping content as near-identical", () => {
    const base = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const tweak = base.replace("word59", "wordZZZ");
    const sim = jaccardSimilarity(contentShingles(base), contentShingles(tweak));
    expect(sim).toBeGreaterThan(0.82);
  });
});

describe("looksLikeQuestion", () => {
  it("detects question marks and question lead-ins", () => {
    expect(looksLikeQuestion("How do I scale this?")).toBe(true);
    expect(looksLikeQuestion("What should I do")).toBe(true);
    expect(looksLikeQuestion("should i pause the campaign")).toBe(true);
    expect(looksLikeQuestion("Here is the framework.")).toBe(false);
    expect(looksLikeQuestion("")).toBe(false);
  });
});

describe("segmentExchanges", () => {
  it("segments speaker-labeled dialogue into prompt/response units", () => {
    const content = [
      "Member: How do I pick my first offer?",
      "Coach: Start with a proven vertical you understand.",
      "Coach: Then validate demand before scaling spend.",
      "Member: What about my budget?",
      "Coach: Keep test budgets small and disciplined.",
    ].join("\n");
    const ex = segmentExchanges(content);
    expect(ex.length).toBe(2);
    expect(ex[0].memberPrompt).toContain("first offer");
    expect(ex[0].coachResponse).toContain("proven vertical");
    expect(ex[0].coachResponse).toContain("validate demand");
    expect(ex[1].memberPrompt).toContain("budget");
    expect(ex.map((e) => e.orderIndex)).toEqual([0, 1]);
  });

  it("segments prose with question paragraphs", () => {
    const content =
      "How do I know when to scale?\n\nScale once you have three profitable days in a row. Watch your margins closely.\n\nWhat is a good starting budget?\n\nUse a small daily cap while testing.";
    const ex = segmentExchanges(content);
    expect(ex.length).toBe(2);
    expect(ex[0].memberPrompt).toContain("scale");
    expect(ex[0].coachResponse).toContain("three profitable days");
  });

  it("falls back to per-block response-only units when there are no questions", () => {
    const content =
      "Focus on one traffic source first.\n\nMaster it before adding another. Diversify later.\n\nTrack every dollar you spend.";
    const ex = segmentExchanges(content);
    expect(ex.length).toBe(3);
    expect(ex.every((e) => e.memberPrompt === "")).toBe(true);
  });

  it("returns nothing for empty content", () => {
    expect(segmentExchanges("")).toEqual([]);
    expect(segmentExchanges("   ")).toEqual([]);
  });
});

describe("computeCalibrationVersion", () => {
  it("returns a stable cold constant for an empty set", () => {
    expect(computeCalibrationVersion([])).toBe("cold-v1");
  });

  it("is order-independent", () => {
    const a = { id: 1, label: "gold", valueType: "principle", memberPrompt: "q", coachResponse: "a" };
    const b = { id: 2, label: "noise", valueType: null, memberPrompt: "", coachResponse: "b" };
    expect(computeCalibrationVersion([a, b])).toBe(computeCalibrationVersion([b, a]));
  });

  it("changes when the exemplar set changes", () => {
    const a = { id: 1, label: "gold", valueType: "principle", memberPrompt: "q", coachResponse: "a" };
    const b = { id: 2, label: "noise", valueType: null, memberPrompt: "", coachResponse: "b" };
    expect(computeCalibrationVersion([a])).not.toBe(computeCalibrationVersion([a, b]));
  });
});

describe("effectiveDisposition", () => {
  it("prefers the admin overrule over the AI verdict", () => {
    expect(effectiveDisposition({ disposition: "drop", overrideDisposition: "keep" })).toBe("keep");
    expect(effectiveDisposition({ disposition: "keep", overrideDisposition: null })).toBe("keep");
  });
});

describe("detectDuplicate", () => {
  const mk = (id: number, content: string) => ({
    id,
    content,
    normalizedHash: exactDedupHash(content),
    shingles: contentShingles(content),
  });

  it("flags an exact duplicate by normalized hash", () => {
    const self = mk(1, "Hello World, this is a coaching call transcript about scaling.");
    const other = mk(2, "hello world this is a coaching call transcript about scaling");
    const v = detectDuplicate(self, [other]);
    expect(v.status).toBe("exact_duplicate");
    expect(v.duplicateOfSourceId).toBe(2);
  });

  it("flags a near duplicate above threshold", () => {
    const base = Array.from({ length: 80 }, (_, i) => `token${i}`).join(" ");
    const near = base.replace("token79", "tokenX").replace("token0", "tokenY");
    const v = detectDuplicate(mk(1, base), [mk(2, near)]);
    expect(v.status).toBe("near_duplicate");
    expect(v.similarityScore).toBeGreaterThan(820);
  });

  it("reports unique when nothing is similar", () => {
    const v = detectDuplicate(mk(1, "completely unrelated alpha beta gamma delta epsilon"), [
      mk(2, "totally different zeta eta theta iota kappa lambda"),
    ]);
    expect(v.status).toBe("unique");
    expect(v.duplicateOfSourceId).toBeNull();
  });
});

describe("member PII backstop", () => {
  it("parses names and rejects non-name values", () => {
    expect(parseMemberName("Jordan Rivera")?.first).toBe("Jordan");
    expect(parseMemberName("Jordan Rivera")?.last).toBe("Rivera");
    expect(parseMemberName("  ")).toBeNull();
    expect(parseMemberName("x")).toBeNull();
    expect(parseMemberName("user@example.com")).toBeNull();
  });

  it("redacts full member names", () => {
    const s = buildMemberPiiScrubber(["Jordan Rivera"]);
    expect(s.scrub("So Jordan Rivera, here's the plan.")).toBe("So [member], here's the plan.");
  });

  it("redacts a bare first name ONLY when the full name also appears", () => {
    const s = buildMemberPiiScrubber(["Jordan Rivera"]);
    const withFull = s.scrub("Jordan Rivera asked, and Jordan, my answer is yes.");
    expect(withFull).not.toContain("Jordan");
    // Without the full name present, a bare first name is left alone.
    const bare = buildMemberPiiScrubber(["Jordan Rivera"]).scrub("Jordan, my answer is yes.");
    expect(bare).toContain("Jordan");
  });

  it("does not redact ambiguous common first names on their own", () => {
    const s = buildMemberPiiScrubber(["Mark Twain"]);
    // 'mark' is ambiguous; only the full name is redacted.
    expect(s.scrub("Mark Twain said to mark your calendar.")).toBe("[member] said to mark your calendar.");
  });

  it("leaves ordinary content untouched", () => {
    const s = buildMemberPiiScrubber(["Jordan Rivera"]);
    expect(s.scrub("Set up your campaign and test the offer.")).toBe(
      "Set up your campaign and test the offer.",
    );
  });
});
