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
  classifySegments,
  effectiveDisposition,
  detectDuplicate,
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

describe("segmentTranscript (topic-threaded)", () => {
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
    expect(segs[0].memberPrompt).toContain("first offer");
    expect(segs[0].coachResponse).toContain("validate demand");
  });

  it("opens a NEW segment on a member turn once past minChars", () => {
    // With a tiny minChars, each new member turn (after a coach reply) starts a
    // fresh topic segment while roles stay preserved.
    const content = [
      "Member: How do I pick my first offer?",
      "Coach: Start with a proven vertical you understand and validate demand first.",
      "Member: What about my budget?",
      "Coach: Keep test budgets small and disciplined until you see signal.",
    ].join("\n");
    const segs = segmentTranscript(content, { minChars: 20, maxChars: 2500 });
    expect(segs.length).toBe(2);
    expect(segs[0].memberPrompt).toContain("first offer");
    expect(segs[1].memberPrompt).toContain("budget");
    expect(segs.map((s) => s.orderIndex)).toEqual([0, 1]);
  });

  it("caps runaway monologues at maxChars even without questions", () => {
    const long = Array.from({ length: 12 }, (_, i) => `Point number ${i} about disciplined scaling.`).join(" ");
    const segs = segmentTranscript(long, { minChars: 50, maxChars: 120 });
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) {
      expect(s.coachResponse.length).toBeLessThanOrEqual(300);
    }
  });

  it("returns nothing for empty content", () => {
    expect(segmentTranscript("")).toEqual([]);
    expect(segmentTranscript("   ")).toEqual([]);
  });
});

describe("classifySegments (reliability + error disposition)", () => {
  const seg = (i: number) => ({ orderIndex: i, memberPrompt: `q${i}`, coachResponse: `a${i}` });

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
