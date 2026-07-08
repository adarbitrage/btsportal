import { db, aiSourceDocumentsTable, transcriptCleanerDocumentsTable, kbCallScreeningsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { normalizeCleanedTranscriptFormat } from "./transcript-cleaner";
import { parseBareLabelTurns, SCREENER_SOURCE_FOLDERS } from "./kb-value-screener";

/**
 * Stored-data format repair (Task #1746).
 *
 * The Transcript Cleaner's LLM output sometimes drifted mid-transcript from the
 * canonical bare-label layout into inline colon dialogue ("Coach: text
 * Member: text …" run together). Documents saved before the cleaner's format
 * contract existed carry those glued stretches, which the value screener's
 * bare-label parser collapses into giant single-verdict pseudo-turns.
 *
 * This boot-time sweep is idempotent and fully deterministic (NO AI re-clean):
 *  - Scans call-transcript `ai_source_documents` AND cleaner holding docs for
 *    the reliable fingerprint: inline canonical speaker labels embedded inside
 *    a parsed bare-label turn body (NOT segment size, which can hide under
 *    thresholds).
 *  - Reformats affected content to the canonical bare-label layout — same
 *    words, same order.
 *  - Deletes (supersedes) any existing screening of a repaired source so its
 *    stale verdicts cannot be read as current (exchange rows cascade).
 *  - Removes stale EMPTY screenings (0 exchanges recorded as `unique` — e.g. a
 *    run that never produced output) so they don't linger as false state.
 *
 * It never triggers re-screening — the admin runs screenings manually.
 */

// The task's conservative fingerprint: a real drift stretch alternates
// speakers, so an affected turn carries at least this many inline labels.
// (A lone incidental "Coach:" inside quoted speech is left untouched.)
export const GLUED_TURN_MIN_INLINE_LABELS = 3;

const INLINE_CANONICAL_LABEL = /\b(Coach|Member|VA)\s*:\s*/g;

/** TRUE when the content parses as bare-label turns and at least one turn body
 *  carries a glued inline-label stretch (the repair fingerprint). */
export function hasGluedInlineLabelStretch(content: string): boolean {
  const turns = parseBareLabelTurns(content);
  if (!turns) return false;
  return turns.some(
    (t) => (t.text.match(INLINE_CANONICAL_LABEL) ?? []).length >= GLUED_TURN_MIN_INLINE_LABELS,
  );
}

/** The call-transcript source types the sweep covers (the screener's coaching
 *  folders plus 1-on-1 VA calls, which share the cleaner's format contract). */
const REPAIR_SOURCE_TYPES = Array.from(new Set([...SCREENER_SOURCE_FOLDERS, "one_on_one_va"]));

export interface FormatRepairSummary {
  repairedSources: number;
  repairedCleanerDocs: number;
  invalidatedScreenings: number;
  staleEmptyScreeningsRemoved: number;
}

export async function repairGluedTranscriptFormats(): Promise<FormatRepairSummary> {
  const summary: FormatRepairSummary = {
    repairedSources: 0,
    repairedCleanerDocs: 0,
    invalidatedScreenings: 0,
    staleEmptyScreeningsRemoved: 0,
  };

  // ── ai_source_documents ────────────────────────────────────────────────
  const sources = await db
    .select({ id: aiSourceDocumentsTable.id, content: aiSourceDocumentsTable.content })
    .from(aiSourceDocumentsTable)
    .where(inArray(aiSourceDocumentsTable.sourceType, REPAIR_SOURCE_TYPES));

  const repairedSourceIds: number[] = [];
  for (const src of sources) {
    if (!src.content || !hasGluedInlineLabelStretch(src.content)) continue;
    const { text, convertedLabels } = normalizeCleanedTranscriptFormat(src.content);
    if (text === src.content) continue;
    await db
      .update(aiSourceDocumentsTable)
      .set({ content: text })
      .where(eq(aiSourceDocumentsTable.id, src.id));
    repairedSourceIds.push(src.id);
    console.warn(
      `[FormatRepair] source ${src.id}: converted ${convertedLabels} glued inline speaker label(s) to canonical bare-label turns.`,
    );
  }
  summary.repairedSources = repairedSourceIds.length;

  // Invalidate (supersede) screenings of repaired sources: their verdicts were
  // produced against glued pseudo-turns. Exchange rows cascade with the
  // screening row. The content change also breaks the fingerprint, but the row
  // must not linger looking like a valid current screening.
  if (repairedSourceIds.length > 0) {
    const deleted = await db
      .delete(kbCallScreeningsTable)
      .where(inArray(kbCallScreeningsTable.sourceDocId, repairedSourceIds))
      .returning({ id: kbCallScreeningsTable.id });
    summary.invalidatedScreenings = deleted.length;
    if (deleted.length > 0) {
      console.warn(
        `[FormatRepair] invalidated ${deleted.length} stale screening(s) of repaired sources (ids ${deleted.map((d) => d.id).join(", ")}) — re-screen manually.`,
      );
    }
  }

  // ── Transcript Cleaner holding docs ────────────────────────────────────
  const holdingDocs = await db
    .select({
      id: transcriptCleanerDocumentsTable.id,
      cleanedContent: transcriptCleanerDocumentsTable.cleanedContent,
    })
    .from(transcriptCleanerDocumentsTable)
    .where(isNotNull(transcriptCleanerDocumentsTable.cleanedContent));

  for (const doc of holdingDocs) {
    const cleaned = doc.cleanedContent ?? "";
    if (!cleaned || !hasGluedInlineLabelStretch(cleaned)) continue;
    const { text, convertedLabels } = normalizeCleanedTranscriptFormat(cleaned);
    if (text === cleaned) continue;
    await db
      .update(transcriptCleanerDocumentsTable)
      .set({ cleanedContent: text })
      .where(eq(transcriptCleanerDocumentsTable.id, doc.id));
    summary.repairedCleanerDocs++;
    console.warn(
      `[FormatRepair] cleaner doc ${doc.id}: converted ${convertedLabels} glued inline speaker label(s) to canonical bare-label turns.`,
    );
  }

  // ── Stale empty screenings ─────────────────────────────────────────────
  // A `unique` screening with ZERO exchanges is a run that produced no output
  // (e.g. screening 20 against the 254/255 duplicate pair before dedup was
  // recorded) — false state that must not read as "already screened".
  const staleEmpty = await db
    .delete(kbCallScreeningsTable)
    .where(and(eq(kbCallScreeningsTable.exchangeCount, 0), eq(kbCallScreeningsTable.dedupStatus, "unique")))
    .returning({ id: kbCallScreeningsTable.id, sourceDocId: kbCallScreeningsTable.sourceDocId });
  summary.staleEmptyScreeningsRemoved = staleEmpty.length;
  if (staleEmpty.length > 0) {
    console.warn(
      `[FormatRepair] superseded ${staleEmpty.length} stale empty screening(s): ${staleEmpty
        .map((s) => `#${s.id} (source ${s.sourceDocId})`)
        .join(", ")}.`,
    );
  }

  return summary;
}
