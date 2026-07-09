/**
 * Retrieval-aligned "Analyze with AI" (Task #1804).
 *
 * Unit tests with MOCKED retrieval — nothing here touches the DB, OpenAI, or
 * the live retrieval path:
 *  - runRetrievalSelfTest: pass/fail mapping of the shared path's candidate
 *    assessment, lexical-only degradation, per-question error isolation,
 *    question cap. Ranking itself lives in kb-retrieval.ts (single source).
 *  - sortHybridPool: the ONE shared tier/blend ordering used by BOTH the live
 *    hybrid merge and the candidate assessment.
 *  - computeRetrievalSelfTestFlag: non-critical flag when questions fail,
 *    silent when all pass; never blocks bulk confirm / trips needsExpert.
 *  - Synonym-gap helpers: normalization + already-covered phrasings are never
 *    proposed.
 *  - triageDoc JSON parsing of the new memberQuestions/suggestedAliases fields.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/kb-synthesis.js", () => ({
  callLLMWithRetry: vi.fn(),
}));
vi.mock("../lib/kb-tool-tags.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/kb-tool-tags.js")>();
  return {
    ...actual,
    getEffectiveTags: () => ["flexy", "anstrex"],
    getEffectiveTagSet: () => new Set(["flexy", "anstrex"]),
    recordProposedToolTag: vi.fn(),
  };
});

import {
  runRetrievalSelfTest,
  type SelfTestDeps,
} from "../lib/kb-retrieval-selftest.js";
import {
  computeRetrievalSelfTestFlag,
  blocksBulkConfirm,
  maxSeverity,
  type RiskFlag,
} from "../lib/kb-flags.js";
import {
  normalizeMemberPhrase,
  normalizeCanonicalTerm,
  isSynonymGap,
} from "../lib/kb-proposed-synonyms.js";
import { triageDoc } from "../lib/kb-triage.js";
import { callLLMWithRetry } from "../lib/kb-synthesis.js";
import {
  CONFIDENCE_FLOOR,
  SEMANTIC_CONFIDENCE_FLOOR,
  sortHybridPool,
  cosineSimilarity,
  type CandidateAssessment,
  type SurfaceRetrievalResult,
} from "../lib/kb-retrieval.js";

function retrievalResult(
  candidate: Partial<CandidateAssessment>,
  extra: Partial<SurfaceRetrievalResult> = {},
): SurfaceRetrievalResult {
  return {
    docs: [],
    confident: false,
    topScore: 0,
    topSemanticScore: 0,
    isNavigationQuery: false,
    detectedTags: [],
    candidate: {
      lexRank: 0,
      semanticScore: 0,
      semanticAvailable: false,
      clearsFloor: false,
      wouldSurface: true,
      ...candidate,
    },
    ...extra,
  };
}

function makeDeps(overrides: Partial<SelfTestDeps> = {}): SelfTestDeps {
  return {
    retrieve: vi.fn().mockResolvedValue(retrievalResult({})),
    embed: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("runRetrievalSelfTest", () => {
  it("passes a question when the shared path says the draft clears the floor and surfaces", async () => {
    const deps = makeDeps({
      retrieve: vi.fn().mockResolvedValue(
        retrievalResult({
          lexRank: CONFIDENCE_FLOOR + 0.1,
          clearsFloor: true,
          wouldSurface: true,
        }),
      ),
    });
    const st = await runRetrievalSelfTest(
      { title: "Flexy Tracking Setup", content: "How to set up Flexy" },
      ["how do I set up flexy?"],
      deps,
    );
    expect(st.results).toHaveLength(1);
    expect(st.results[0].passed).toBe(true);
    expect(st.results[0].clearsFloor).toBe(true);
    expect(st.results[0].wouldSurface).toBe(true);
    expect(st.passedCount).toBe(1);
    expect(st.failedCount).toBe(0);
    expect(st.semanticAvailable).toBe(false); // lexical-only run
  });

  it("fails a question when the draft is below both floors", async () => {
    const st = await runRetrievalSelfTest(
      { title: "T", content: "C" },
      ["completely unrelated ask"],
      makeDeps(),
    );
    expect(st.results[0].passed).toBe(false);
    expect(st.results[0].clearsFloor).toBe(false);
    expect(st.failedCount).toBe(1);
  });

  it("fails a floor-clearing question when the shared merge says it would NOT surface", async () => {
    const deps = makeDeps({
      retrieve: vi.fn().mockResolvedValue(
        retrievalResult({ lexRank: 0.2, clearsFloor: true, wouldSurface: false }),
      ),
    });
    const st = await runRetrievalSelfTest({ title: "T", content: "C" }, ["q"], deps);
    expect(st.results[0].clearsFloor).toBe(true);
    expect(st.results[0].wouldSurface).toBe(false);
    expect(st.results[0].passed).toBe(false);
  });

  it("passes on semantic similarity alone; marks the run semantic-available", async () => {
    const deps = makeDeps({
      embed: vi.fn().mockResolvedValue([0.5, 0.5, 0.5]),
      retrieve: vi.fn().mockResolvedValue(
        retrievalResult({
          semanticScore: SEMANTIC_CONFIDENCE_FLOOR + 0.2,
          semanticAvailable: true,
          clearsFloor: true,
          wouldSurface: true,
        }),
      ),
    });
    const st = await runRetrievalSelfTest({ title: "T", content: "C" }, ["q"], deps);
    expect(st.semanticAvailable).toBe(true);
    expect(st.results[0].draftSemanticScore).toBeGreaterThanOrEqual(SEMANTIC_CONFIDENCE_FLOOR);
    expect(st.results[0].passed).toBe(true);
  });

  it("passes the draft's ad-hoc embedding + class/tags into the shared candidate", async () => {
    const vec = [0.1, 0.2, 0.3];
    const retrieve = vi.fn().mockResolvedValue(retrievalResult({}));
    const deps = makeDeps({ retrieve, embed: vi.fn().mockResolvedValue(vec) });
    await runRetrievalSelfTest(
      { title: "T", content: "C", docClass: "curated", tags: ["flexy"] },
      ["q"],
      deps,
    );
    expect(retrieve).toHaveBeenCalledWith("q", {
      title: "T",
      content: "C",
      docClass: "curated",
      tags: ["flexy"],
      embedding: vec,
    });
  });

  it("records the top live competitor for reviewer context", async () => {
    const deps = makeDeps({
      retrieve: vi.fn().mockResolvedValue(
        retrievalResult(
          { lexRank: 0.2 },
          {
            docs: [{ id: 1, title: "Live Doc", content: "", category: "process", docClass: null, homeRoot: null, node: null, tags: [], sourcePath: null, sourceLabel: null, rank: 0.3, semanticScore: 0.6, grounded: false }],
            topScore: 0.3,
            topSemanticScore: 0.6,
          },
        ),
      ),
    });
    const st = await runRetrievalSelfTest({ title: "T", content: "C" }, ["q"], deps);
    expect(st.results[0].topLiveTitle).toBe("Live Doc");
    expect(st.results[0].topLiveLexRank).toBeCloseTo(0.3);
    expect(st.results[0].topLiveSemanticScore).toBeCloseTo(0.6);
  });

  it("caps questions at 5 and drops blanks", async () => {
    const st = await runRetrievalSelfTest(
      { title: "T", content: "C" },
      ["a", " ", "b", "c", "d", "e", "f"],
      makeDeps(),
    );
    expect(st.memberQuestions).toEqual(["a", "b", "c", "d", "e"]);
    expect(st.results).toHaveLength(5);
  });

  it("isolates a per-question retrieval error as a failed question, not a crash", async () => {
    const retrieve = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(
        retrievalResult({ lexRank: 1, clearsFloor: true, wouldSurface: true }),
      );
    const st = await runRetrievalSelfTest(
      { title: "T", content: "C" },
      ["q1", "q2"],
      makeDeps({ retrieve }),
    );
    expect(st.results[0].passed).toBe(false); // errored question
    expect(st.results[1].passed).toBe(true);
    expect(st.passedCount).toBe(1);
    expect(st.failedCount).toBe(1);
  });

  it("treats a missing candidate assessment as a failed question (contract guard)", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      docs: [],
      confident: false,
      topScore: 0,
      topSemanticScore: 0,
      isNavigationQuery: false,
      detectedTags: [],
      // no candidate — the shared path was called without the candidate option
    });
    const st = await runRetrievalSelfTest({ title: "T", content: "C" }, ["q"], makeDeps({ retrieve }));
    expect(st.results[0].passed).toBe(false);
  });
});

describe("sortHybridPool (shared live-merge + candidate ordering)", () => {
  const doc = (
    rank: number,
    semanticScore = 0,
    docClass: string | null = null,
    tags: string[] = [],
  ) => ({ rank, semanticScore, docClass, tags });

  it("ranks curated/overview/navigation strictly above non-curated", () => {
    const pool = [doc(0.9, 0.9), doc(0.01, 0, "curated"), doc(0.02, 0, "navigation")];
    const sorted = sortHybridPool([...pool], []);
    expect(sorted[0].docClass).not.toBeNull();
    expect(sorted[1].docClass).not.toBeNull();
    expect(sorted[2].docClass).toBeNull();
  });

  it("boosts docs carrying a detected tag within the same curated tier", () => {
    const tagged = doc(0.01, 0, null, ["flexy"]);
    const stronger = doc(0.9, 0.9);
    const sorted = sortHybridPool([stronger, tagged], ["flexy"]);
    expect(sorted[0]).toBe(tagged);
  });

  it("orders by the lexical+semantic blend within the same tier", () => {
    const lexOnly = doc(1.0, 0); // blend 0.5 (normalized max lex)
    const semStrong = doc(0.1, 0.9); // blend 0.05 + 0.45 = 0.5-ish; make it clearly bigger
    const semStronger = doc(0.1, 0.95);
    const sorted = sortHybridPool([lexOnly, semStronger, semStrong], []);
    expect(sorted[0]).toBe(semStronger);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors, 0 for orthogonal or empty", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([], [1])).toBe(0);
  });
});

describe("computeRetrievalSelfTestFlag", () => {
  it("returns null for null / empty / all-passing self-tests", () => {
    expect(computeRetrievalSelfTestFlag(null)).toBeNull();
    expect(computeRetrievalSelfTestFlag(undefined)).toBeNull();
    expect(computeRetrievalSelfTestFlag({ results: [] })).toBeNull();
    expect(
      computeRetrievalSelfTestFlag({ results: [{ question: "q", passed: true }] }),
    ).toBeNull();
  });

  it("flags failing questions as NON-critical medium and names them", () => {
    const flag = computeRetrievalSelfTestFlag({
      results: [
        { question: "how do I get my money back?", passed: false },
        { question: "q2", passed: true },
      ],
    })!;
    expect(flag.type).toBe("retrieval_gap");
    expect(flag.severity).toBe("medium");
    expect(flag.message).toContain("1/2");
    expect(flag.detail).toContain("money back");
    // Never trips needsExpert (critical) nor blocks bulk confirm.
    const flags: RiskFlag[] = [flag];
    expect(maxSeverity(flags)).toBe("medium");
    expect(blocksBulkConfirm(flags)).toBe(false);
  });
});

describe("synonym-gap helpers", () => {
  it("normalizes phrases and canonical terms", () => {
    expect(normalizeMemberPhrase("  Money   BACK  ")).toBe("money back");
    expect(normalizeCanonicalTerm("Refund!! Policy")).toBe("refund policy");
  });

  it("is not a gap when the code alias map already covers the phrasing", () => {
    // "money back" is covered by the existing refund alias map entry.
    expect(isSynonymGap("money back")).toBe(false);
  });

  it("is a gap for genuinely uncovered phrasings; rejects blanks/short", () => {
    expect(isSynonymGap("wumbelfrag gizmo tracking")).toBe(true);
    expect(isSynonymGap("")).toBe(false);
    expect(isSynonymGap(" a ")).toBe(false);
  });
});

describe("triageDoc parses the new #1804 output fields", () => {
  const baseResponse = {
    cleanedTitle: "Flexy Campaign Tracking Setup",
    summary: "s",
    suggestedCategory: "sop",
    suggestedHomeRoot: "process",
    suggestedNode: "creative-assets",
    suggestedDocClass: "transcript",
    suggestedTags: ["flexy"],
    observedTools: [],
    reasoning: "ok",
  };

  it("returns trimmed, capped memberQuestions and well-formed suggestedAliases", async () => {
    vi.mocked(callLLMWithRetry).mockResolvedValueOnce(
      JSON.stringify({
        ...baseResponse,
        memberQuestions: [" how do I track? ", "", "q2", "q3", "q4", "q5", "q6"],
        suggestedAliases: [
          { memberPhrase: " link cloaker ", canonicalTerm: "tracking link" },
          { memberPhrase: "", canonicalTerm: "x" }, // dropped: blank phrase
          "not-an-object",
        ],
      }),
    );
    const result = await triageDoc({ title: "t", content: "c" });
    expect(result.memberQuestions).toEqual(["how do I track?", "q2", "q3", "q4", "q5"]);
    expect(result.suggestedAliases).toEqual([
      { memberPhrase: "link cloaker", canonicalTerm: "tracking link" },
    ]);
  });

  it("defaults both fields to [] when the model omits them (existing behaviour stays green)", async () => {
    vi.mocked(callLLMWithRetry).mockResolvedValueOnce(JSON.stringify(baseResponse));
    const result = await triageDoc({ title: "t", content: "c" });
    expect(result.memberQuestions).toEqual([]);
    expect(result.suggestedAliases).toEqual([]);
    expect(result.cleanedTitle).toBe("Flexy Campaign Tracking Setup");
  });
});
