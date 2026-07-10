/**
 * Bounded retention for captured unanswered member questions
 * (content_gap_questions, written by lib/content-gap-radar.ts).
 *
 * The capture pipeline dedups near-identical questions on insert (upsert keyed
 * by surface + normalized question), but the store still needs a hard bound:
 *   1. AGE — rows whose last_asked_at is older than the retention window are
 *      deleted (a question nobody has asked in months is stale demand signal).
 *   2. VOLUME — beyond a max row count, the least-recently-asked rows are
 *      trimmed so a burst of one-off questions can never grow the table
 *      without bound.
 *
 * Follows the same daily-interval cleanup pattern as the other retention
 * sweeps started from app.ts (e.g. queue-fallback-audit-cleanup).
 */

import { db, contentGapQuestionsTable } from "@workspace/db";
import { lt, inArray } from "drizzle-orm";
import { desc } from "drizzle-orm";

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Rows not asked again within this window are dropped. */
export const CONTENT_GAP_RETENTION_DAYS = 180;

/** Hard cap on stored distinct questions; overflow trims least-recently-asked. */
export const CONTENT_GAP_MAX_ROWS = 5000;

export interface ContentGapCleanupOverrides {
  retentionDays?: number;
  maxRows?: number;
}

export async function runContentGapQuestionsCleanup(
  overrides: ContentGapCleanupOverrides = {},
): Promise<{ deletedByAge: number; deletedByVolume: number }> {
  const retentionDays = overrides.retentionDays ?? CONTENT_GAP_RETENTION_DAYS;
  const maxRows = overrides.maxRows ?? CONTENT_GAP_MAX_ROWS;

  // 1. Age bound.
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const ageResult = await db
    .delete(contentGapQuestionsTable)
    .where(lt(contentGapQuestionsTable.lastAskedAt, cutoff));
  const deletedByAge = ageResult.rowCount ?? 0;

  // 2. Volume bound — keep the `maxRows` most-recently-asked rows, delete the
  // rest (least-recently-asked overflow). Batched via id list so the delete
  // stays a plain predicate.
  const overflow = await db
    .select({ id: contentGapQuestionsTable.id })
    .from(contentGapQuestionsTable)
    .orderBy(desc(contentGapQuestionsTable.lastAskedAt), desc(contentGapQuestionsTable.id))
    .offset(maxRows);
  let deletedByVolume = 0;
  if (overflow.length > 0) {
    const volResult = await db
      .delete(contentGapQuestionsTable)
      .where(inArray(contentGapQuestionsTable.id, overflow.map((r) => r.id)));
    deletedByVolume = volResult.rowCount ?? 0;
  }

  if (deletedByAge > 0 || deletedByVolume > 0) {
    console.log(
      `[ContentGapQuestionsCleanup] Deleted ${deletedByAge} row(s) older than ${retentionDays}d and ${deletedByVolume} overflow row(s) beyond the ${maxRows}-row cap`,
    );
  }
  return { deletedByAge, deletedByVolume };
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startContentGapQuestionsCleanupJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    runContentGapQuestionsCleanup().catch((err) => {
      console.error("[ContentGapQuestionsCleanup] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[ContentGapQuestionsCleanup] Started cleanup job (every ${RUN_INTERVAL_MS / 60000}m, retention ${CONTENT_GAP_RETENTION_DAYS}d, cap ${CONTENT_GAP_MAX_ROWS} rows)`,
  );
  runContentGapQuestionsCleanup().catch((err) => {
    console.error("[ContentGapQuestionsCleanup] Initial run failed:", err);
  });
}

export function stopContentGapQuestionsCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
