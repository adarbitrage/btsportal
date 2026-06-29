/**
 * Content-Gap Radar (demand-side) — Task #8.
 *
 * Logs the questions the AI assistants (chat + voice) could NOT confidently
 * answer, so authoring is driven by real demand instead of guesswork. Called at
 * the "no confident match" point in the retrieval/answer flow (chat's no-answer
 * fallback and voice's no-info sentinel).
 *
 * Repeats group by (surface, normalized_question): each occurrence increments
 * ask_count and refreshes last_asked_at + the latest context, so the most-asked
 * gaps rise to the top of the admin list.
 *
 * Privacy: the question text and near-miss titles are run through the existing
 * answer-time privacy scrub BEFORE being stored — the radar never persists raw
 * PII.
 *
 * Best-effort by design: any failure is swallowed (logged, never thrown) so a
 * radar hiccup can never break a member's chat/voice turn.
 */

import { db, contentGapQuestionsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { scrubPrivateContent } from "./content-privacy-filter";
import type { RetrievalSurface } from "./kb-retrieval";

/** A retriever doc that surfaced but did not clear the confidence bar. */
export interface NearMissDoc {
  id: number;
  title: string;
  rank: number;
}

export interface LogUnansweredQuestionInput {
  surface: RetrievalSurface;
  /** The member's question as asked (raw — scrubbed here before storage). */
  question: string;
  /** Top precise-match ts_rank at the time of the miss (0 when only fallback hit). */
  topScore?: number;
  /** Nearest non-confident matches the retriever surfaced. */
  nearMisses?: NearMissDoc[];
}

const MAX_QUESTION_LEN = 500;
const MAX_NEAR_MISSES = 5;

/**
 * Normalize a question into a stable grouping key: lowercase, collapse
 * whitespace, strip surrounding/ trailing punctuation. Near-identical repeats
 * ("How do I get a refund?" vs "how do i get a refund") collapse to one row.
 */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

/**
 * Record an unanswered / low-confidence question. Idempotent per
 * (surface, normalized question) — upserts and increments ask_count on repeats.
 *
 * Never throws; safe to `void` from a request handler.
 */
export async function logUnansweredQuestion(
  input: LogUnansweredQuestionInput,
): Promise<void> {
  try {
    const raw = (input.question ?? "").trim();
    if (!raw) return;

    // Privacy scrub the display text, then cap length.
    const questionText = scrubPrivateContent(raw).slice(0, MAX_QUESTION_LEN);
    const normalizedQuestion = normalizeQuestion(questionText).slice(0, MAX_QUESTION_LEN);
    if (!normalizedQuestion) return;

    const nearMisses = (input.nearMisses ?? [])
      .slice(0, MAX_NEAR_MISSES)
      .map((d) => ({
        id: d.id,
        title: scrubPrivateContent(d.title ?? "").slice(0, 200),
        score: Number.isFinite(d.rank) ? d.rank : 0,
      }));

    const topScore = Number.isFinite(input.topScore) ? (input.topScore as number) : 0;
    const now = new Date();

    await db
      .insert(contentGapQuestionsTable)
      .values({
        surface: input.surface,
        normalizedQuestion,
        questionText,
        topScore,
        nearMisses,
        lastAskedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          contentGapQuestionsTable.surface,
          contentGapQuestionsTable.normalizedQuestion,
        ],
        set: {
          askCount: sql`${contentGapQuestionsTable.askCount} + 1`,
          questionText,
          topScore,
          nearMisses,
          lastAskedAt: now,
          updatedAt: now,
        },
      });
  } catch (err) {
    // Best-effort: a radar failure must never break the assistant turn.
    console.error("[content-gap-radar] failed to log unanswered question:", err);
  }
}
