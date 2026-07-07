import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The core lib imports callLLM from "./kb-synthesis.js"; mock it so the
// reliability/classification tests never hit a real model. The dedup/segment
// helpers under test are pure and never call it.
const callLLMMock = vi.fn();
vi.mock("./kb-synthesis.js", () => ({ callLLM: (...args: unknown[]) => callLLMMock(...args) }));

import {
  normalizeForDedup,
  exactDedupHash,
  contentShingles,
  jaccardSimilarity,
  looksLikeQuestion,
  segmentTranscript,
  parseBareLabelTurns,
  parseDialogueTurns,
  splitOversizeText,
  applyQaPairing,
  computeAnomalyFlags,
  classifySegments,
  effectiveDisposition,
  detectDuplicate,
  EMPTY_COMPLETION_REASON,
  SEGMENT_MAX_CHARS,
  type Segment,
} from "./kb-value-screener";

beforeEach(() => {
  callLLMMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("segmentTranscript (topic-threaded, role-labeled passages)", () => {
  it("threads a topic (question + answer + follow-ups) into ONE segment", () => {
    // A short exchange stays a single segment because the follow-up member turn
    // only opens a new segment once the current one has passed minChars.
    const content = [
      "Member: How do I pick my first offer?",
      "Coach: Start with a proven vertical you understand.",
      "Coach: Then validate demand before scaling spend.",
      "Member: What about my budget?",
      "Coach: Keep test budgets small and disciplined.",
    ].join("\n");
    const segs = segmentTranscript(content);
    expect(segs.length).toBe(1);
    expect(segs[0].anchorQuestion).toContain("first offer");
    expect(segs[0].passage).toContain("Coach: Then validate demand");
    expect(segs[0].passage).toContain("Member: How do I pick my first offer?");
  });

  it("opens a NEW segment on a member turn once past minChars", () => {
    const content = [
      "Member: How do I pick my first offer?",
      "Coach: Start with a proven vertical you understand and validate demand first.",
      "Member: What about my budget?",
      "Coach: Keep test budgets small and disciplined until you see signal.",
    ].join("\n");
    const segs = segmentTranscript(content, { minChars: 20, maxChars: 2500 });
    expect(segs.length).toBe(2);
    expect(segs[0].anchorQuestion).toContain("first offer");
    expect(segs[1].anchorQuestion).toContain("budget");
    expect(segs.map((s) => s.orderIndex)).toEqual([0, 1]);
  });

  it("caps runaway monologues at maxChars even without questions", () => {
    const long = Array.from({ length: 12 }, (_, i) => `Point number ${i} about disciplined scaling.`).join(" ");
    const segs = segmentTranscript(long, { minChars: 50, maxChars: 120 });
    expect(segs.length).toBeGreaterThan(1);
  });

  it("returns nothing for empty content", () => {
    expect(segmentTranscript("")).toEqual([]);
    expect(segmentTranscript("   ")).toEqual([]);
  });

  it("parses the Transcript Cleaner's bare-label format (label on its OWN line)", () => {
    const content = [
      "Coach",
      "Welcome back everyone, let's dig into offer selection today.",
      "",
      "Member",
      "How do I know if my landing page is the problem?",
      "",
      "Coach",
      "Check your click-through rate first. If it is above two percent the page is fine.",
      "",
      "Member",
      "Got it, thank you.",
    ].join("\n");
    const segs = segmentTranscript(content, { minChars: 20, maxChars: 2500 });
    expect(segs.length).toBeGreaterThanOrEqual(1);
    const joined = segs.map((s) => s.passage).join("\n");
    // Real labels drive roles — the coach's non-question opener is Coach, the
    // member's question is Member.
    expect(joined).toContain("Coach: Welcome back everyone");
    expect(joined).toContain("Member: How do I know if my landing page");
    expect(joined).toContain("Coach: Check your click-through rate");
  });

  it("does NOT flip into colon-dialogue mode on incidental colons in prose", () => {
    // A prose transcript with a few incidental "Name: text" looking lines
    // (e.g. "Warning: do not overspend.") must NOT glue everything onto a few
    // giant pseudo-turns: the majority rule keeps it in prose mode and the
    // hard cap keeps every segment bounded.
    const proseLine =
      "The coach walked through the whole campaign setup and explained why tracking matters so much for scaling decisions.";
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) {
      lines.push(`${proseLine} Iteration ${i} adds more detail about budgets and creatives.`);
      if (i % 10 === 0) lines.push("Warning: do not overspend on day one.");
    }
    const content = lines.join("\n");
    const segs = segmentTranscript(content, { minChars: 200, maxChars: 800 });
    expect(segs.length).toBeGreaterThan(3);
    for (const s of segs) expect(s.passage.length).toBeLessThanOrEqual(900);
  });

  it("never emits a segment above the max-char cap even for one giant labeled turn", () => {
    const giant = Array.from({ length: 200 }, (_, i) => `Sentence ${i} about disciplined testing.`).join(" ");
    const content = ["Coach", giant, "Member", "Thanks!", "Coach", "You're welcome."].join("\n");
    const segs = segmentTranscript(content, { minChars: 100, maxChars: 500 });
    expect(segs.length).toBeGreaterThan(3);
    for (const s of segs) {
      // passage adds "Coach: " labels; allow small labeling overhead only.
      expect(s.passage.length).toBeLessThanOrEqual(520);
    }
  });
});

describe("parseBareLabelTurns / parseDialogueTurns (format detection)", () => {
  it("rejects prose with one-off capitalized heading lines", () => {
    const content = ["Introduction", "This call covered scaling.", "Summary", "Scale slowly."].join("\n");
    expect(parseBareLabelTurns(content)).toBeNull();
  });

  it("accepts recurring name labels even when not role words", () => {
    const content = [
      "Sasha", "Let's talk about your funnel today and what to fix first.",
      "Jordan", "How do I fix my funnel?",
      "Sasha", "Start with the headline and match it to the ad.",
      "Jordan", "That makes sense.",
    ].join("\n");
    const turns = parseBareLabelTurns(content);
    expect(turns).not.toBeNull();
    expect(turns!.length).toBe(4);
  });

  it("requires a MAJORITY of lines to be colon-labeled for dialogue mode", () => {
    const mostlyProse = [
      "Coach: Quick note before we start.",
      "The rest of this transcript is plain prose without any labels at all.",
      "It keeps going for many lines describing the campaign strategy.",
      "Coach: Another aside.",
      "More prose here about budgets.",
      "Coach: Third aside.",
      "Final prose line about creatives.",
    ].join("\n");
    expect(parseDialogueTurns(mostlyProse)).toBeNull();

    const mostlyLabeled = [
      "Coach: Welcome.",
      "Member: How do I start?",
      "Coach: Pick one offer.",
      "Member: Ok.",
    ].join("\n");
    expect(parseDialogueTurns(mostlyLabeled)).not.toBeNull();
  });
});

describe("splitOversizeText (hard cap safety net)", () => {
  it("splits at sentence boundaries into blocks under the cap", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const parts = splitOversizeText(text, 100);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(100);
    expect(parts.join(" ")).toContain("Sentence number 29");
  });

  it("keeps a single over-long sentence whole (anomaly flag catches it)", () => {
    const oneSentence = "word ".repeat(100).trim() + ".";
    const parts = splitOversizeText(oneSentence, 50);
    expect(parts.length).toBe(1);
  });

  it("returns short text untouched", () => {
    expect(splitOversizeText("short.", 100)).toEqual(["short."]);
  });
});

describe("applyQaPairing (orphan member question never dropped alone)", () => {
  const cls = (disposition: "keep" | "drop" | "flag" | "error", dropReason: string | null = null) => ({
    valueType: "unclassified" as const,
    disposition,
    dropReason,
    situationalNumber: false,
    contextBound: false,
    rationale: "",
  });
  const memberSeg = (i: number, q: string): Segment => ({
    orderIndex: i,
    passage: `Member: ${q}`,
    anchorQuestion: q,
    memberOnly: true,
  });
  const coachSeg = (i: number, a: string): Segment => ({
    orderIndex: i,
    passage: `Coach: ${a}`,
    anchorQuestion: null,
    memberOnly: false,
  });

  it("folds a dropped member-only question into the following kept coach segment", () => {
    const segments = [memberSeg(0, "How do I set my daily budget?"), coachSeg(1, "Start at fifty dollars.")];
    const classifications = [cls("drop", "no coach instruction present"), cls("keep")];
    applyQaPairing(segments, classifications);
    expect(segments[1].anchorQuestion).toContain("daily budget");
    expect(classifications[0].dropReason).toContain("folded into the following kept segment");
  });

  it("leaves the question dropped (no fold) when the answer is dropped too", () => {
    const segments = [memberSeg(0, "Can you hear me?"), coachSeg(1, "Yes, loud and clear.")];
    const classifications = [cls("drop", "tech check"), cls("drop", "tech check")];
    applyQaPairing(segments, classifications);
    expect(segments[1].anchorQuestion).toBeNull();
    expect(classifications[0].dropReason).toBe("tech check");
  });

  it("does not touch kept member segments or non-member-only drops", () => {
    const segments = [coachSeg(0, "Logistics chatter."), coachSeg(1, "Real teaching.")];
    const classifications = [cls("drop", "logistics"), cls("keep")];
    applyQaPairing(segments, classifications);
    expect(segments[1].anchorQuestion).toBeNull();
    expect(classifications[0].dropReason).toBe("logistics");
  });
});

describe("computeAnomalyFlags", () => {
  const base = {
    exchangeCount: 20,
    keptCount: 15,
    droppedCount: 3,
    flaggedCount: 2,
    maxSegmentChars: 1800,
    sourceCharCount: 40000,
  };

  it("passes a healthy screening with no flags", () => {
    expect(computeAnomalyFlags(base)).toEqual([]);
  });

  it("flags an oversized segment", () => {
    expect(computeAnomalyFlags({ ...base, maxSegmentChars: SEGMENT_MAX_CHARS + 1 })).toContain("oversized_segment");
  });

  it("flags a full-length call with implausibly few segments", () => {
    expect(
      computeAnomalyFlags({ ...base, exchangeCount: 2, keptCount: 1, droppedCount: 1, flaggedCount: 0, sourceCharCount: 51000 }),
    ).toContain("low_segment_count");
  });

  it("does not length-flag an exact duplicate (zero segments by design)", () => {
    expect(
      computeAnomalyFlags({
        ...base,
        exchangeCount: 0,
        keptCount: 0,
        droppedCount: 0,
        flaggedCount: 0,
        dedupStatus: "exact_duplicate",
      }),
    ).toEqual([]);
  });

  it("flags an all-error screening", () => {
    expect(
      computeAnomalyFlags({ ...base, exchangeCount: 29, keptCount: 0, droppedCount: 0, flaggedCount: 0 }),
    ).toContain("all_error");
  });
});

describe("classifySegments (reliability + error disposition)", () => {
  const seg = (i: number): Segment => ({
    orderIndex: i,
    passage: `Member: q${i}\nCoach: a${i}`,
    anchorQuestion: `q${i}`,
    memberOnly: false,
  });

  it("maps a clean model response to real verdicts", async () => {
    callLLMMock.mockResolvedValueOnce(
      JSON.stringify({
        results: [
          { index: 0, valueType: "principle", disposition: "keep", situationalNumber: false, rationale: "solid" },
          { index: 1, valueType: "chitchat", disposition: "drop", dropReason: "greeting", rationale: "filler" },
        ],
      }),
    );
    const out = await classifySegments([seg(0), seg(1)]);
    expect(out.map((c) => c.disposition)).toEqual(["keep", "drop"]);
    expect(out[0].dropReason).toBeNull();
    expect(out[1].dropReason).toBe("greeting");
  });

  it("marks a segment the model OMITS with the distinct 'error' disposition", async () => {
    callLLMMock.mockResolvedValueOnce(
      JSON.stringify({
        results: [{ index: 0, valueType: "principle", disposition: "keep", rationale: "ok" }],
      }),
    );
    const out = await classifySegments([seg(0), seg(1)]);
    expect(out[0].disposition).toBe("keep");
    expect(out[1].disposition).toBe("error");
  });

  it("isolates a whole-chunk failure to 'error' (never a silent drop) after retries", async () => {
    callLLMMock.mockRejectedValue(new Error("model down"));
    const out = await classifySegments([seg(0), seg(1)]);
    expect(out.every((c) => c.disposition === "error")).toBe(true);
    // Retried CLASSIFY_MAX_ATTEMPTS (3) times for the single chunk.
    expect(callLLMMock).toHaveBeenCalledTimes(3);
  });

  it("recovers on a later retry attempt", async () => {
    callLLMMock
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(
        JSON.stringify({ results: [{ index: 0, valueType: "framework", disposition: "keep", rationale: "good" }] }),
      );
    const out = await classifySegments([seg(0)]);
    expect(out[0].disposition).toBe("keep");
    expect(callLLMMock).toHaveBeenCalledTimes(2);
  });

  it("records an EMPTY completion with the distinct token-budget reason", async () => {
    callLLMMock.mockResolvedValue(""); // finish_reason=length: empty content every attempt
    const out = await classifySegments([seg(0), seg(1)]);
    expect(out.every((c) => c.disposition === "error")).toBe(true);
    expect(out[0].dropReason).toBe(EMPTY_COMPLETION_REASON);
    expect(callLLMMock).toHaveBeenCalledTimes(3);
  });

  it("downgrades a model-assigned 'error' verdict to 'flag' (model may not self-error)", async () => {
    callLLMMock.mockResolvedValueOnce(
      JSON.stringify({ results: [{ index: 0, valueType: "principle", disposition: "error", rationale: "?" }] }),
    );
    const out = await classifySegments([seg(0)]);
    expect(out[0].disposition).toBe("flag");
  });

  it("keeps situational/time-sensitive answers rather than dropping them", async () => {
    callLLMMock.mockResolvedValueOnce(
      JSON.stringify({
        results: [
          { index: 0, valueType: "situational_answer", disposition: "keep", situationalNumber: true, rationale: "member-specific" },
        ],
      }),
    );
    const out = await classifySegments([seg(0)]);
    expect(out[0].disposition).toBe("keep");
    expect(out[0].situationalNumber).toBe(true);
  });
});

describe("effectiveDisposition", () => {
  it("prefers the admin overrule over the AI verdict", () => {
    expect(effectiveDisposition({ disposition: "drop", overrideDisposition: "keep" })).toBe("keep");
    expect(effectiveDisposition({ disposition: "keep", overrideDisposition: null })).toBe("keep");
    expect(effectiveDisposition({ disposition: "error", overrideDisposition: "drop" })).toBe("drop");
  });
});

describe("detectDuplicate (narrowed to near-identical WHOLE calls)", () => {
  const mk = (id: number, content: string) => ({
    id,
    content,
    length: normalizeForDedup(content).length,
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

  it("flags a near-verbatim re-upload above the HIGH threshold", () => {
    const base = Array.from({ length: 120 }, (_, i) => `token${i}`).join(" ");
    const near = base.replace("token119", "tokenX").replace("token0", "tokenY");
    const v = detectDuplicate(mk(1, base), [mk(2, near)]);
    expect(v.status).toBe("near_duplicate");
    expect(v.similarityScore).toBeGreaterThan(900);
  });

  it("does NOT flag two distinct calls that merely share a topic", () => {
    // Substantial but sub-threshold overlap (same topic words, different call).
    const shared = Array.from({ length: 30 }, (_, i) => `topic${i}`).join(" ");
    const a = `${shared} ${Array.from({ length: 40 }, (_, i) => `aonly${i}`).join(" ")}`;
    const b = `${shared} ${Array.from({ length: 40 }, (_, i) => `bonly${i}`).join(" ")}`;
    const v = detectDuplicate(mk(1, a), [mk(2, b)]);
    expect(v.status).toBe("unique");
  });

  it("does NOT flag a short excerpt against a full call (length-ratio guard)", () => {
    const full = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const excerpt = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    const v = detectDuplicate(mk(2, excerpt), [mk(1, full)]);
    expect(v.status).toBe("unique");
  });

  it("reports unique when nothing is similar", () => {
    const v = detectDuplicate(mk(1, "completely unrelated alpha beta gamma delta epsilon"), [
      mk(2, "totally different zeta eta theta iota kappa lambda"),
    ]);
    expect(v.status).toBe("unique");
    expect(v.duplicateOfSourceId).toBeNull();
  });
});
