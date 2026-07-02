/**
 * Backfill: rewrite stored OLD-BRAND references in already-cleaned / filed AI
 * source content.
 *
 * Task #1604 added old-brand -> BTS rebrand rules to the shared privacy filter
 * (lib/content-privacy-filter.ts). Those apply to NEW transcript cleans / refine
 * and at retrieval time, but they do NOT rewrite content that was already
 * cleaned into the Transcript Cleaner holding store or already filed into the AI
 * Source Knowledge library — those rows still carry the old brand in storage.
 *
 * The seeded `knowledgebase_docs` rows are already covered by the existing
 * re-scrub pass (rescrub-knowledgebase-docs.ts, run on boot + in post-merge).
 * The two tables WITHOUT a re-scrub pass are the gap this closes:
 *   - transcript_cleaner_documents (holding store): cleaned_content + the title
 *     fields title / suggested_title / proposed_title.
 *   - ai_source_documents (filed raw-source library): content + title.
 *
 * SCOPE DISCIPLINE — old-brand ONLY. These are raw mining input where coach /
 * VA attribution is meaningful (authority labelling), so we deliberately do NOT
 * run the full privacy filter here (that would strip coach surnames and damage
 * the data). We reuse the exact OLD_BRAND_REBRAND_RULES from the shared filter
 * via rebrandOldBrandContent(), so the backfill stays in lockstep with the
 * cleaner and never hand-duplicates the patterns.
 *
 * Idempotent and safe to re-run: rebranded text no longer matches the old-brand
 * patterns and content with no old-brand reference is returned untouched, so
 * only rows that actually change are written and a second run is a no-op.
 *
 * This module is pure logic with NO CLI side-effects so it is safe to import
 * from server startup (bootstrap-critical-prerequisites.ts) and from tests. The
 * CLI entrypoint lives in ../scripts/rebrand-old-brand-source-content.ts, which
 * is run directly via tsx (post-merge.sh) and is never bundled into the server.
 */
import { db, transcriptCleanerDocumentsTable, aiSourceDocumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { rebrandOldBrandContent } from "./content-privacy-filter";

export interface RebrandTableResult {
  scanned: number;
  updated: number;
}

export interface RebrandOldBrandResult {
  transcriptCleaner: RebrandTableResult;
  aiSource: RebrandTableResult;
}

/**
 * Rebrand a single field value. Returns the rebranded string only when it
 * actually changed; otherwise `null` (nothing to write). NULL / undefined input
 * is preserved as "no change" so nullable columns keep their NULL.
 */
function rebrandChanged(value: string | null | undefined): string | null {
  if (value == null) return null;
  const next = rebrandOldBrandContent(value);
  return next === value ? null : next;
}

async function rebrandTranscriptCleaner(
  log: (msg: string) => void,
): Promise<RebrandTableResult> {
  const rows = await db
    .select({
      id: transcriptCleanerDocumentsTable.id,
      title: transcriptCleanerDocumentsTable.title,
      suggestedTitle: transcriptCleanerDocumentsTable.suggestedTitle,
      proposedTitle: transcriptCleanerDocumentsTable.proposedTitle,
      cleanedContent: transcriptCleanerDocumentsTable.cleanedContent,
    })
    .from(transcriptCleanerDocumentsTable);

  log(`[rebrand] scanning ${rows.length} transcript_cleaner_documents rows...`);

  let updated = 0;
  for (const row of rows) {
    const set: {
      title?: string;
      suggestedTitle?: string;
      cleanedContent?: string;
      proposedTitle?: string;
    } = {};

    const title = rebrandChanged(row.title);
    if (title !== null) set.title = title;
    const suggestedTitle = rebrandChanged(row.suggestedTitle);
    if (suggestedTitle !== null) set.suggestedTitle = suggestedTitle;
    const proposedTitle = rebrandChanged(row.proposedTitle);
    if (proposedTitle !== null) set.proposedTitle = proposedTitle;
    const cleanedContent = rebrandChanged(row.cleanedContent);
    if (cleanedContent !== null) set.cleanedContent = cleanedContent;

    if (Object.keys(set).length === 0) continue;

    await db
      .update(transcriptCleanerDocumentsTable)
      .set(set)
      .where(eq(transcriptCleanerDocumentsTable.id, row.id));
    updated++;
    log(
      `[rebrand] transcript_cleaner_documents #${row.id} rebranded (${Object.keys(set).join(", ")}).`,
    );
  }

  log(
    `[rebrand] transcript_cleaner_documents done. ${updated} row(s) updated across ${rows.length}.`,
  );
  return { scanned: rows.length, updated };
}

async function rebrandAiSource(
  log: (msg: string) => void,
): Promise<RebrandTableResult> {
  const rows = await db
    .select({
      id: aiSourceDocumentsTable.id,
      title: aiSourceDocumentsTable.title,
      content: aiSourceDocumentsTable.content,
    })
    .from(aiSourceDocumentsTable);

  log(`[rebrand] scanning ${rows.length} ai_source_documents rows...`);

  let updated = 0;
  for (const row of rows) {
    const set: { title?: string; content?: string } = {};

    const title = rebrandChanged(row.title);
    if (title !== null) set.title = title;
    const content = rebrandChanged(row.content);
    if (content !== null) set.content = content;

    if (Object.keys(set).length === 0) continue;

    await db
      .update(aiSourceDocumentsTable)
      .set(set)
      .where(eq(aiSourceDocumentsTable.id, row.id));
    updated++;
    log(
      `[rebrand] ai_source_documents #${row.id} rebranded (${Object.keys(set).join(", ")}).`,
    );
  }

  log(
    `[rebrand] ai_source_documents done. ${updated} row(s) updated across ${rows.length}.`,
  );
  return { scanned: rows.length, updated };
}

/**
 * Rebrand old-brand references across both raw-source tables. Returns per-table
 * { scanned, updated } counts. Idempotent: a second call with nothing left to
 * rebrand makes zero writes. Safe to import from tests (does not call
 * process.exit). Operates on the database the env points to.
 */
export async function rebrandOldBrandSourceContent(
  log: (msg: string) => void = () => {},
): Promise<RebrandOldBrandResult> {
  const transcriptCleaner = await rebrandTranscriptCleaner(log);
  const aiSource = await rebrandAiSource(log);
  return { transcriptCleaner, aiSource };
}
