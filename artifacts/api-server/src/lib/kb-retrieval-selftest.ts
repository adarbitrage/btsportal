/**
 * Retrieval self-test for staging drafts (Task #1804).
 *
 * Answers "if a member asked the questions this doc is supposed to answer,
 * would the assistant actually find it?" — BEFORE the doc goes live. Each
 * AI-generated member question is run through the REAL shared retrieval path
 * (retrieveSurfaceAware, chat surface, all three roots) with the draft passed
 * as an EPHEMERAL CANDIDATE: the shared path scores the draft against the
 * exact same primary tsquery (including the synonym OR expansion) the live
 * docs are matched with, and ranks it inside the same curated-tier / tag-tier
 * / lexical+semantic-blend merge the live assistant uses. There is NO
 * self-test-local ranking math — kb-retrieval.ts is the single source of
 * truth.
 *
 * The draft embedding is computed once per run and DISCARDED — staging docs
 * never store embeddings. Read-only against live retrieval: nothing here
 * changes ranking, stores embeddings, or writes to live docs.
 */

import {
  retrieveSurfaceAware,
  type EphemeralCandidate,
  type SurfaceRetrievalResult,
} from "./kb-retrieval.js";
import { embedText } from "./kb-embeddings.js";

/** Chat-surface scope: all three member-facing roots (mirrors config default). */
const SELF_TEST_CATEGORIES = ["operations", "process", "concepts"];
const SELF_TEST_LIMIT = 6;

export interface SelfTestQuestionResult {
  question: string;
  /** ts_rank of the draft vs the live primary tsquery (synonyms included). */
  draftLexRank: number;
  /** Cosine similarity draft↔question (0 when the semantic layer is off). */
  draftSemanticScore: number;
  /** Draft clears the live confidence bar (lexical OR semantic floor). */
  clearsFloor: boolean;
  /** Draft ranked within the retrieval limit in the shared live merge. */
  wouldSurface: boolean;
  passed: boolean;
  /** Best live doc for this question (what currently wins), for reviewer context. */
  topLiveTitle: string | null;
  topLiveLexRank: number;
  topLiveSemanticScore: number;
}

/** Per-title outcome summary for the evidence-based title comparison. */
export interface TitleOutcomeSummary {
  title: string;
  passedCount: number;
  total: number;
  /** Questions that pass under this title. */
  passedQuestions: string[];
}

/**
 * Title comparison (Task #1865): both the stored title and the AI-proposed
 * title are scored through the SAME self-test questions. The comparison is
 * ALWAYS attached when a fresh suggestion exists — it is advisory only and the
 * reviewer applies the suggestion on click (never auto-accepted).
 */
export interface TitleComparison {
  current: TitleOutcomeSummary;
  suggested: TitleOutcomeSummary;
  /** Suggested title measurably beats the current one. */
  improved: boolean;
  /** Improved with zero regressions (every question at least as good). */
  strictlyBetter: boolean;
  /** Current title violates brand/canonical-naming rules; suggestion fixes it. */
  brandFix: boolean;
}

export interface RetrievalSelfTest {
  ranAt: string;
  /** False = OPENAI_API_KEY absent/failed — lexical-only self-test this run. */
  semanticAvailable: boolean;
  memberQuestions: string[];
  results: SelfTestQuestionResult[];
  passedCount: number;
  failedCount: number;
  /** Present only when a title suggestion was measured this run (Task #1848). */
  titleComparison?: TitleComparison;
}

/** Injectable deps so unit tests never touch the DB / OpenAI / live retrieval. */
export interface SelfTestDeps {
  /** The shared retrieval path with the draft injected as ephemeral candidate. */
  retrieve: (question: string, candidate: EphemeralCandidate) => Promise<SurfaceRetrievalResult>;
  /** Ad-hoc draft embedding (null = lexical-only). Result is DISCARDED after the run. */
  embed: (text: string) => Promise<number[] | null>;
}

const defaultDeps: SelfTestDeps = {
  retrieve: (question, candidate) =>
    retrieveSurfaceAware(question, {
      surface: "chat",
      categories: SELF_TEST_CATEGORIES,
      limit: SELF_TEST_LIMIT,
      candidate,
    }),
  embed: embedText,
};

/**
 * Run the full self-test for one draft. Never throws — a per-question failure
 * records zeros for that question rather than aborting analysis.
 */
export async function runRetrievalSelfTest(
  draft: { title: string; content: string; docClass?: string | null; tags?: string[] },
  memberQuestions: string[],
  deps: SelfTestDeps = defaultDeps,
): Promise<RetrievalSelfTest> {
  const questions = memberQuestions.map((q) => q.trim()).filter(Boolean).slice(0, 5);
  const draftText = `${draft.title}\n\n${draft.content}`;

  // Ad-hoc draft embedding — computed once per run, never stored.
  const draftEmbedding = await deps.embed(draftText).catch(() => null);

  const results: SelfTestQuestionResult[] = [];
  let anySemantic = false;
  for (const question of questions) {
    try {
      const live = await deps.retrieve(question, {
        title: draft.title,
        content: draft.content,
        docClass: draft.docClass ?? null,
        tags: draft.tags ?? [],
        embedding: draftEmbedding,
      });
      const assessment = live.candidate;
      if (!assessment) throw new Error("retrieval returned no candidate assessment");
      if (assessment.semanticAvailable) anySemantic = true;

      const topLive = live.docs[0] ?? null;
      results.push({
        question,
        draftLexRank: Number(assessment.lexRank.toFixed(4)),
        draftSemanticScore: Number(assessment.semanticScore.toFixed(4)),
        clearsFloor: assessment.clearsFloor,
        wouldSurface: assessment.wouldSurface,
        passed: assessment.clearsFloor && assessment.wouldSurface,
        topLiveTitle: topLive?.title ?? null,
        topLiveLexRank: Number((live.topScore ?? 0).toFixed(4)),
        topLiveSemanticScore: Number((live.topSemanticScore ?? 0).toFixed(4)),
      });
    } catch (err) {
      console.error(`[kb-selftest] question failed ("${question.slice(0, 80)}"):`, err);
      results.push({
        question,
        draftLexRank: 0,
        draftSemanticScore: 0,
        clearsFloor: false,
        wouldSurface: false,
        passed: false,
        topLiveTitle: null,
        topLiveLexRank: 0,
        topLiveSemanticScore: 0,
      });
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  return {
    ranAt: new Date().toISOString(),
    semanticAvailable: anySemantic,
    memberQuestions: questions,
    results,
    passedCount,
    failedCount: results.length - passedCount,
  };
}
