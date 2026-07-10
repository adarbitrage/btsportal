/**
 * AI title suggestion lifecycle + retrieval self-test re-score (Task #1865).
 *
 * Unit tests (no DB, no LLM): the module's DB/LLM/retrieval seams are mocked
 * so we can assert:
 *  - analysis ALWAYS re-proposes a fresh title, ALWAYS attaches the before/after
 *    comparison, and clears any prior accept/dismiss/edit decision — acceptance
 *    is accept-on-click only, nothing is auto-applied (auto-accept is retired);
 *  - the stored title always stands: the self-test verdict + flags are judged
 *    against the STORED title, never the un-accepted suggestion;
 *  - rescoreSelfTestForTitle: retrieval-only re-run of the stored questions
 *    against the kept title, replacing exactly the retrieval_gap flag;
 *  - the related-topics auto-fix persists to the column the reviewed content
 *    actually lives in, and is not re-persisted when nothing changed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Seams ────────────────────────────────────────────────────────────────────

const { updateSetCalls, insertValues, mockDb } = vi.hoisted(() => {
  const updateSetCalls: Record<string, unknown>[] = [];
  const insertValues: Record<string, unknown>[] = [];
  const mockDb = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSetCalls.push(values);
        return { where: async () => undefined };
      },
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        insertValues.push(v);
        return undefined;
      },
    }),
    select: () => ({
      from: () => ({ where: async () => [] }),
    }),
  };
  return { updateSetCalls, insertValues, mockDb };
});

vi.mock("@workspace/db", () => ({ db: mockDb }));

const runRetrievalSelfTestMock = vi.fn();
vi.mock("../lib/kb-retrieval-selftest.js", () => ({
  runRetrievalSelfTest: (...args: unknown[]) => runRetrievalSelfTestMock(...args),
}));

const llmMock = vi.fn();
vi.mock("../lib/kb-synthesis.js", () => ({
  callLLMWithRetry: (...args: unknown[]) => llmMock(...args),
}));

vi.mock("../lib/kb-proposed-synonyms.js", () => ({
  recordProposedSynonym: vi.fn(async () => undefined),
}));
vi.mock("../lib/kb-tool-tags.js", () => ({
  getEffectiveTags: () => ["flexy"],
  getEffectiveTagSet: () => new Set(["flexy"]),
  recordProposedToolTag: vi.fn(async () => undefined),
}));

const gatherFlagContextMock = vi.fn(async (_arg?: unknown) => ({
  duplicateTitle: null,
  conflictsWithVerified: null,
}));
const computeRiskFlagsInputs: Record<string, unknown>[] = [];
vi.mock("../lib/kb-flags.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/kb-flags.js")>();
  return {
    ...actual,
    gatherFlagContext: (arg: unknown) => gatherFlagContextMock(arg),
    computeRiskFlags: (input: Record<string, unknown>) => {
      computeRiskFlagsInputs.push(input);
      return actual.computeRiskFlags(input as never);
    },
  };
});

import { runAutoTriageOnDoc, rescoreSelfTestForTitle, replaceRetrievalGapFlag } from "../lib/kb-triage.js";
import { computeRetrievalSelfTestFlag, type RiskFlag } from "../lib/kb-flags.js";
import type { RetrievalSelfTest } from "../lib/kb-retrieval-selftest.js";
import type { kbStagingDocsTable } from "@workspace/db/schema";

type StagingDoc = typeof kbStagingDocsTable.$inferSelect;

const passingSelfTest = (questions: string[]): RetrievalSelfTest => ({
  ranAt: new Date().toISOString(),
  semanticAvailable: false,
  memberQuestions: questions,
  results: questions.map((question) => ({
    question,
    draftLexRank: 0.5,
    draftSemanticScore: 0,
    clearsFloor: true,
    wouldSurface: true,
    passed: true,
    topLiveTitle: null,
    topLiveLexRank: 0,
    topLiveSemanticScore: 0,
  })),
  passedCount: questions.length,
  failedCount: 0,
});

const failingSelfTest = (questions: string[]): RetrievalSelfTest => ({
  ...passingSelfTest(questions),
  results: questions.map((question) => ({
    question,
    draftLexRank: 0,
    draftSemanticScore: 0,
    clearsFloor: false,
    wouldSurface: false,
    passed: false,
    topLiveTitle: "Some live doc",
    topLiveLexRank: 0.4,
    topLiveSemanticScore: 0,
  })),
  passedCount: 0,
  failedCount: questions.length,
});

const baseDoc = (overrides: Partial<StagingDoc> = {}): StagingDoc =>
  ({
    id: 1,
    title: "Stored Title",
    category: "curriculum",
    content: "# Doc\n\nBody.",
    tags: "",
    status: "needs_review",
    editedContent: null,
    homeRoot: "process",
    node: "testing",
    docClassTarget: null,
    authorityRole: null,
    corroborationCount: 0,
    riskFlags: [],
    aiCleanedTitle: null,
    aiTitleDecision: null,
    aiSuggestedTaxonomy: null,
    retrievalSelfTest: null,
    needsExpert: false,
    ...overrides,
  }) as unknown as StagingDoc;

const triageJson = (cleanedTitle: string) =>
  JSON.stringify({
    cleanedTitle,
    summary: "A summary",
    suggestedCategory: "curriculum",
    suggestedHomeRoot: "process",
    suggestedNode: "testing",
    suggestedDocClass: "transcript",
    suggestedCeiling: "operational",
    suggestedTags: [],
    observedTools: [],
    memberQuestions: ["how do i run testing rounds?"],
    suggestedAliases: [],
    reasoning: "",
  });

beforeEach(() => {
  updateSetCalls.length = 0;
  insertValues.length = 0;
  computeRiskFlagsInputs.length = 0;
  runRetrievalSelfTestMock.mockReset();
  llmMock.mockReset();
  gatherFlagContextMock.mockClear();
  runRetrievalSelfTestMock.mockImplementation(async (_draft, questions: string[]) =>
    passingSelfTest(questions),
  );
});

/** Mock the dual self-test so the SUGGESTED title beats the stored one:
 * the stored title fails every question, the suggested title passes. Keyed on
 * the title passed to runRetrievalSelfTest so both calls resolve correctly. */
function suggestedTitleWins(suggested: string) {
  runRetrievalSelfTestMock.mockImplementation(
    async (draft: { title: string }, questions: string[]) =>
      draft.title === suggested ? passingSelfTest(questions) : failingSelfTest(questions),
  );
}

describe("title-suggestion lifecycle in analysis (Task #1865)", () => {
  it("surfaces the suggestion, self-tests BOTH titles, and never auto-applies", async () => {
    llmMock.mockResolvedValue(triageJson("AI Suggested Title"));
    suggestedTitleWins("AI Suggested Title");
    await runAutoTriageOnDoc(baseDoc());
    const set = updateSetCalls.find((s) => "aiRecommendedAction" in s)!;
    // The suggestion is surfaced (persisted to aiCleanedTitle) but the stored
    // title is never overwritten and the decision stays open (accept-on-click).
    expect(set.aiCleanedTitle).toBe("AI Suggested Title");
    expect("title" in set).toBe(false);
    expect(set.aiTitleDecision).toBeNull();
    // Both the stored and the suggested title were scored (always compare).
    expect(runRetrievalSelfTestMock).toHaveBeenCalledTimes(2);
    const scoredTitles = runRetrievalSelfTestMock.mock.calls.map(
      (c) => (c[0] as { title: string }).title,
    );
    expect(scoredTitles).toEqual(expect.arrayContaining(["Stored Title", "AI Suggested Title"]));
    // The standing self-test is the stored one, and carries the comparison.
    const cmp = (set.retrievalSelfTest as RetrievalSelfTest).titleComparison!;
    expect(cmp.improved).toBe(true);
    expect(cmp.current.title).toBe("Stored Title");
    expect(cmp.suggested.title).toBe("AI Suggested Title");
    // No auto-accept: the comparison shape no longer carries an autoAccepted flag
    // and no title_auto_accepted audit is written.
    expect("autoAccepted" in cmp).toBe(false);
    expect(insertValues.some((v) => v.eventType === "title_auto_accepted")).toBe(false);
  });

  it.each(["accepted", "dismissed", "edited"] as const)(
    "%s doc: re-analysis re-proposes a fresh suggestion and clears the decision",
    async (decision) => {
      llmMock.mockResolvedValue(triageJson("A Fresh Churned Title"));
      await runAutoTriageOnDoc(
        baseDoc({ aiTitleDecision: decision, aiCleanedTitle: "Old Suggestion" }),
      );
      const set = updateSetCalls.find((s) => "aiRecommendedAction" in s)!;
      // The prior decision is cleared and a fresh suggestion is surfaced.
      expect(set.aiCleanedTitle).toBe("A Fresh Churned Title");
      expect(set.aiTitleDecision).toBeNull();
      // The stored title still stands and is what the verdict judges.
      expect("title" in set).toBe(false);
      expect(computeRiskFlagsInputs[0]).toMatchObject({ title: "Stored Title" });
      // Duplicate-title context must also judge by the stored title.
      expect(gatherFlagContextMock).toHaveBeenCalledWith(
        expect.objectContaining({ aiCleanedTitle: null }),
      );
    },
  );
});

describe("always propose + always compare (Task #1865)", () => {
  it("surfaces a suggestion even when it does NOT beat the stored title", async () => {
    // Both titles pass every question equally → no measurable win, but the
    // suggestion is still surfaced with the before/after comparison.
    llmMock.mockResolvedValue(triageJson("Equally Good Title"));
    await runAutoTriageOnDoc(baseDoc());
    const set = updateSetCalls.find((s) => "aiRecommendedAction" in s)!;
    expect(set.aiCleanedTitle).toBe("Equally Good Title");
    expect("title" in set).toBe(false);
    const cmp = (set.retrievalSelfTest as RetrievalSelfTest).titleComparison!;
    expect(cmp.improved).toBe(false);
    // The stored title is what everything downstream judges.
    expect(computeRiskFlagsInputs[0]).toMatchObject({ title: "Stored Title" });
    expect(gatherFlagContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ aiCleanedTitle: null }),
    );
  });

  it("flags a brand violation in the comparison", async () => {
    // Stored title carries a dropped affiliate-network name; suggestion is clean.
    llmMock.mockResolvedValue(triageJson("Clean Modern Title"));
    await runAutoTriageOnDoc(baseDoc({ title: "MaxWeb Payouts Guide" }));
    const set = updateSetCalls.find((s) => "aiRecommendedAction" in s)!;
    expect(set.aiCleanedTitle).toBe("Clean Modern Title");
    const cmp = (set.retrievalSelfTest as RetrievalSelfTest).titleComparison!;
    expect(cmp.brandFix).toBe(true);
  });

  it("no proposal (LLM returns the stored title): single self-test, nothing surfaced", async () => {
    llmMock.mockResolvedValue(triageJson("Stored Title"));
    await runAutoTriageOnDoc(baseDoc());
    const set = updateSetCalls.find((s) => "aiRecommendedAction" in s)!;
    expect(set.aiCleanedTitle).toBeNull();
    expect(runRetrievalSelfTestMock).toHaveBeenCalledTimes(1);
    expect((set.retrievalSelfTest as RetrievalSelfTest).titleComparison).toBeUndefined();
  });
});

describe("filed placement is authoritative (Task #1847)", () => {
  it("curated-FILED doc: self-tests as curated even when the run suggests transcript", async () => {
    // triageJson suggests docClass "transcript"; the doc is filed curated.
    llmMock.mockResolvedValue(triageJson("T"));
    await runAutoTriageOnDoc(baseDoc({ docClassTarget: "curated" }));
    // Every self-test (both titles) must judge the doc as FILED (curated).
    for (const call of runRetrievalSelfTestMock.mock.calls) {
      expect((call[0] as { docClass: string | null }).docClass).toBe("curated");
    }
  });

  it("never-filed doc: falls back to the AI-suggested doc class for the self-test", async () => {
    llmMock.mockResolvedValue(triageJson("T"));
    await runAutoTriageOnDoc(
      baseDoc({ docClassTarget: null, homeRoot: null, node: null }),
    );
    expect(
      (runRetrievalSelfTestMock.mock.calls[0][0] as { docClass: string | null }).docClass,
    ).toBe("transcript");
  });

  it("flags are judged against ONE coherent FILED placement — never a filed/suggested hybrid", async () => {
    // Filed: concepts/angles/curated. Suggestion (triageJson): process/testing/transcript.
    llmMock.mockResolvedValue(triageJson("T"));
    await runAutoTriageOnDoc(
      baseDoc({ homeRoot: "concepts", node: "angles", docClassTarget: "curated" }),
    );
    expect(computeRiskFlagsInputs).toHaveLength(1);
    expect(computeRiskFlagsInputs[0]).toMatchObject({
      homeRoot: "concepts",
      node: "angles",
      docClassTarget: "curated",
    });
  });

  it("flags fall back to the suggestion per-field only for never-filed fields", async () => {
    llmMock.mockResolvedValue(triageJson("T"));
    await runAutoTriageOnDoc(
      baseDoc({ homeRoot: null, node: null, docClassTarget: "curated" }),
    );
    expect(computeRiskFlagsInputs[0]).toMatchObject({
      homeRoot: "process", // suggested (never filed)
      node: "testing", // suggested (never filed)
      docClassTarget: "curated", // filed wins
    });
  });

  it("FILED doc: re-analysis never regenerates the taxonomy suggestion (advisory + stable)", async () => {
    llmMock.mockResolvedValue(triageJson("T"));
    await runAutoTriageOnDoc(
      baseDoc({
        homeRoot: "process",
        node: "testing",
        docClassTarget: "curated",
        aiSuggestedTaxonomy: { homeRoot: "operations", node: "navigation" } as never,
      }),
    );
    const set = updateSetCalls.find((s) => "aiRecommendedAction" in s)!;
    expect("aiSuggestedTaxonomy" in set).toBe(false);
    expect("aiSuggestedCategory" in set).toBe(false);
  });

  it("never-filed doc: re-analysis still stores a fresh taxonomy suggestion (incl. ceiling)", async () => {
    llmMock.mockResolvedValue(triageJson("T"));
    await runAutoTriageOnDoc(
      baseDoc({ homeRoot: null, node: null, docClassTarget: null }),
    );
    const set = updateSetCalls.find((s) => "aiRecommendedAction" in s)!;
    expect(set.aiSuggestedTaxonomy).toMatchObject({
      homeRoot: "process",
      node: "testing",
      docClass: "transcript",
      ceiling: "operational",
    });
    expect(set.aiSuggestedCategory).toBe("curriculum");
  });
});

describe("related-topics auto-fix persistence in analysis", () => {
  const dirtyContent =
    "# Doc\n\nBody.\n\n## Related topics\n- Billing & Refunds\n- Launch";

  it("persists the fix to `content` when there is no editedContent", async () => {
    llmMock.mockResolvedValue(triageJson("T"));
    await runAutoTriageOnDoc(baseDoc({ content: dirtyContent }));
    const set = updateSetCalls.find((s) => "aiRecommendedAction" in s)!;
    expect(set.content).toContain("- Launch");
    expect(set.content).not.toContain("Billing & Refunds");
    expect("editedContent" in set).toBe(false);
  });

  it("persists the fix to `editedContent` when the doc has one", async () => {
    llmMock.mockResolvedValue(triageJson("T"));
    await runAutoTriageOnDoc(baseDoc({ editedContent: dirtyContent }));
    const set = updateSetCalls.find((s) => "aiRecommendedAction" in s)!;
    expect(set.editedContent).not.toContain("Billing & Refunds");
    expect("content" in set).toBe(false);
  });

  it("never rewrites an UNFILED doc, even when the AI suggests a taxonomy", async () => {
    // triageJson suggests process/testing — auto-fix must ignore it and judge
    // by the FILED placement only, so an unfiled doc is left untouched and the
    // mismatch flag stays a human signal.
    llmMock.mockResolvedValue(triageJson("T"));
    await runAutoTriageOnDoc(baseDoc({ content: dirtyContent, homeRoot: null, node: null }));
    const set = updateSetCalls.find((s) => "aiRecommendedAction" in s)!;
    expect("content" in set).toBe(false);
    expect("editedContent" in set).toBe(false);
  });

  it("does not persist anything when the section is already clean (idempotent)", async () => {
    llmMock.mockResolvedValue(triageJson("T"));
    await runAutoTriageOnDoc(
      baseDoc({ content: "# Doc\n\nBody.\n\n## Related topics\n- Launch" }),
    );
    const set = updateSetCalls.find((s) => "aiRecommendedAction" in s)!;
    expect("content" in set).toBe(false);
    expect("editedContent" in set).toBe(false);
  });
});

describe("rescoreSelfTestForTitle", () => {
  it("no stored self-test: does nothing (no retrieval, no write)", async () => {
    await rescoreSelfTestForTitle(baseDoc(), "Stored Title");
    expect(runRetrievalSelfTestMock).not.toHaveBeenCalled();
    expect(updateSetCalls.length).toBe(0);
  });

  it("re-runs the STORED questions against the kept title and clears a stale retrieval_gap flag", async () => {
    const questions = ["how do i run testing rounds?", "what is a testing round?"];
    const staleGap = computeRetrievalSelfTestFlag(failingSelfTest(questions))!;
    const doc = baseDoc({
      retrievalSelfTest: failingSelfTest(questions) as never,
      riskFlags: [staleGap, { type: "single_source", severity: "low", message: "m" }] as never,
    });
    await rescoreSelfTestForTitle(doc, "Stored Title");
    expect(runRetrievalSelfTestMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Stored Title" }),
      questions,
    );
    const set = updateSetCalls[0];
    const flags = set.riskFlags as RiskFlag[];
    expect(flags.find((f) => f.type === "retrieval_gap")).toBeUndefined();
    expect(flags.find((f) => f.type === "single_source")).toBeDefined();
    expect((set.retrievalSelfTest as RetrievalSelfTest).passedCount).toBe(2);
  });

  it("adds the retrieval_gap flag when the kept title fails the questions", async () => {
    const questions = ["how do i run testing rounds?"];
    runRetrievalSelfTestMock.mockImplementation(async (_d, qs: string[]) => failingSelfTest(qs));
    const doc = baseDoc({
      retrievalSelfTest: passingSelfTest(questions) as never,
      riskFlags: [] as never,
    });
    await rescoreSelfTestForTitle(doc, "Stored Title");
    const flags = updateSetCalls[0].riskFlags as RiskFlag[];
    expect(flags.find((f) => f.type === "retrieval_gap")).toBeDefined();
  });

  it("keeps the old verdict when retrieval blows up (never clobbers)", async () => {
    runRetrievalSelfTestMock.mockRejectedValue(new Error("retrieval down"));
    const doc = baseDoc({ retrievalSelfTest: passingSelfTest(["q"]) as never });
    await rescoreSelfTestForTitle(doc, "Stored Title");
    expect(updateSetCalls.length).toBe(0);
  });
});

describe("replaceRetrievalGapFlag", () => {
  const gap: RiskFlag = { type: "retrieval_gap", severity: "medium", message: "old" };
  const other: RiskFlag = { type: "conflict", severity: "critical", message: "keep me" };

  it("swaps the old gap flag for a fresh one and preserves other flags", () => {
    const next = replaceRetrievalGapFlag([gap, other], failingSelfTest(["q"]));
    expect(next.filter((f) => f.type === "retrieval_gap").length).toBe(1);
    expect(next.find((f) => f.type === "retrieval_gap")!.message).not.toBe("old");
    expect(next).toContainEqual(other);
  });

  it("clears the gap flag when the new self-test passes", () => {
    const next = replaceRetrievalGapFlag([gap, other], passingSelfTest(["q"]));
    expect(next.find((f) => f.type === "retrieval_gap")).toBeUndefined();
    expect(next).toContainEqual(other);
  });
});
