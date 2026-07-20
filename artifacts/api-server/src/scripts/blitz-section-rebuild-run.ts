/**
 * Blitz section-doc generation + import run (resumable, per-doc commit).
 * For each of the 29 manifest entries:
 *   1. Skip if ai_source_documents already has the exact title (idempotent).
 *   2. Generate via gpt-5 (loud failure — an error aborts the run; rerun resumes).
 *   3. File into ai_source_documents (reference_docs / curriculum) with hash.
 *   4. Insert a kb_staging_docs review row (source = blitz_section_import),
 *      skipped if ANY-status staging row already carries the title marker.
 *      Staged UNTAGGED — tags come from step 5, never from trigger scanning.
 *   5. Run the standard AI analysis (runAutoTriageOnDoc) so an advisory 0-4
 *      "aboutness" tag suggestion is stored for reviewer Apply (filed
 *      placement preserved). Non-fatal on failure; also backfilled on rerun
 *      for existing untagged rows missing a suggestion.
 * Ends with `COMPLETE n/n` only when every entry is present.
 */
import { db, aiSourceDocumentsTable, kbStagingDocsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  buildManifestFromCorpus,
  generateBlitzSectionDoc,
  BLITZ_SECTION_IMPORT_SOURCE,
} from "../lib/blitz-section-docgen";
import { fingerprintContent } from "../lib/kb-source-windows";
import { runAutoTriageOnDoc } from "../lib/kb-triage";

/**
 * Proper tag suggestion: run the same AI analysis the review dialog uses.
 * The doc is filed (homeRoot/node set), so when it has NO tags analysis writes
 * an advisory tag-only suggestion (placement preserved). No-ops when the doc
 * already has tags or a stored tag suggestion. A failure is loud but
 * non-fatal — the reviewer can hit Re-analyze in the UI.
 */
async function analyzeIfMissingSuggestion(stagingId: number): Promise<void> {
  try {
    const [doc] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, stagingId));
    if (!doc) {
      console.error(`  ANALYSIS SKIPPED — staging #${stagingId} not found on re-fetch`);
      return;
    }
    const tags = Array.isArray(doc.taxonomyTags) ? (doc.taxonomyTags as string[]) : [];
    const suggestion = doc.aiSuggestedTaxonomy as { tags?: string[] } | null;
    if (tags.length > 0 || (Array.isArray(suggestion?.tags) && suggestion.tags.length > 0)) return;
    await runAutoTriageOnDoc(doc);
    console.log(`  analyzed #${stagingId} — advisory tag suggestion stored`);
  } catch (err) {
    console.error(`  ANALYSIS FAILED for staging #${stagingId} (tags missing — use Re-analyze in the review dialog):`, err);
  }
}

async function main() {
  const transcripts = await db
    .select({ id: aiSourceDocumentsTable.id, title: aiSourceDocumentsTable.title, content: aiSourceDocumentsTable.content })
    .from(aiSourceDocumentsTable)
    .where(eq(aiSourceDocumentsTable.sourceType, "blitz_video"));
  const manifest = buildManifestFromCorpus(transcripts);
  console.log(`Manifest: ${manifest.length} docs`);

  let done = 0;
  for (const entry of manifest) {
    const existing = await db
      .select({ id: aiSourceDocumentsTable.id })
      .from(aiSourceDocumentsTable)
      .where(and(
        eq(aiSourceDocumentsTable.title, entry.title),
        eq(aiSourceDocumentsTable.sourceType, "reference_docs"),
      ));
    let sourceId: number;
    let content: string;
    if (existing.length > 0) {
      sourceId = existing[0].id;
      const [row] = await db
        .select({ content: aiSourceDocumentsTable.content })
        .from(aiSourceDocumentsTable)
        .where(eq(aiSourceDocumentsTable.id, sourceId));
      content = row.content;
      console.log(`SKIP-GEN (exists #${sourceId}): ${entry.title}`);
    } else {
      const t0 = Date.now();
      content = await generateBlitzSectionDoc(entry);
      const [inserted] = await db
        .insert(aiSourceDocumentsTable)
        .values({
          title: entry.title,
          content,
          sourceType: "reference_docs",
          authorityRole: "curriculum",
          sourceName: "The Blitz™ Guide (section rebuild)",
          provenanceNote: `Generated from the Blitz guide section ${entry.section.id} ("${entry.section.title}") + ${entry.transcripts.length} video transcript(s) via blitz-section-docgen (part ${entry.partIndex}/${entry.partCount}).`,
          contentHash: fingerprintContent(content),
        })
        .returning({ id: aiSourceDocumentsTable.id });
      sourceId = inserted.id;
      console.log(`GENERATED #${sourceId} (${content.length} chars, ${((Date.now()-t0)/1000).toFixed(0)}s): ${entry.title}`);
    }

    const marker = entry.title.trim();
    const stagingExisting = await db
      .select({ id: kbStagingDocsTable.id })
      .from(kbStagingDocsTable)
      .where(and(
        eq(kbStagingDocsTable.source, BLITZ_SECTION_IMPORT_SOURCE),
        eq(kbStagingDocsTable.sourceVideoTitle, marker),
      ));
    if (stagingExisting.length > 0) {
      console.log(`  staging exists (#${stagingExisting[0].id})`);
      // Resumability gap-closer: a prior run interrupted between staging and
      // analysis leaves an untagged row with no tag suggestion — analyze it now.
      await analyzeIfMissingSuggestion(stagingExisting[0].id);
    } else {
      // Tags are NOT trigger-scanned from the body (that tagged every tool
      // mentioned in passing — up to 23 tags/doc). Stage untagged and let the
      // AI analysis below propose 0-4 aboutness tags (advisory, reviewer
      // applies them on the Document Review page), matching the synthesis
      // pipeline's tagging path.
      const [stg] = await db
        .insert(kbStagingDocsTable)
        .values({
          title: entry.title,
          category: "curriculum",
          content,
          status: "needs_review",
          source: BLITZ_SECTION_IMPORT_SOURCE,
          sourceVideoTitle: marker,
          sourceVideoId: `ai-src-${sourceId}`,
          audience: "member",
          docType: "existing_doc",
          originType: "curated_upload",
          authorityRole: "curriculum",
          docClassTarget: "curated",
          homeRoot: "process",
          node: entry.processNode,
          taxonomyTags: [],
          blitzSection: entry.section.id,
          ceiling: "operational",
          phase: entry.section.phase,
          adminNotes: `Section-anchored Blitz reference doc (rebuild): guide section ${entry.section.id} "${entry.section.title}", part ${entry.partIndex}/${entry.partCount}, ${entry.transcripts.length} transcript(s) enriched.`,
        })
        .returning({ id: kbStagingDocsTable.id });
      console.log(`  staged #${stg.id} [${entry.processNode}] (untagged — AI tag suggestion next)`);
      await analyzeIfMissingSuggestion(stg.id);
    }
    done++;
  }
  console.log(`COMPLETE ${done}/${manifest.length}`);
  process.exit(0);
}
main().catch((e) => { console.error("RUN FAILED (resume by rerunning):", e); process.exit(1); });
