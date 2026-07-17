/**
 * Blitz section-doc generation + import run (resumable, per-doc commit).
 * For each of the 29 manifest entries:
 *   1. Skip if ai_source_documents already has the exact title (idempotent).
 *   2. Generate via gpt-5 (loud failure — an error aborts the run; rerun resumes).
 *   3. File into ai_source_documents (reference_docs / curriculum) with hash.
 *   4. Insert a kb_staging_docs review row (source = blitz_section_import),
 *      skipped if ANY-status staging row already carries the title marker.
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
import { detectTagsFromTriggers } from "../lib/kb-taxonomy";
import { getEffectiveTags, getEffectiveTagTriggers } from "../lib/kb-tool-tags";

async function main() {
  const transcripts = await db
    .select({ id: aiSourceDocumentsTable.id, title: aiSourceDocumentsTable.title, content: aiSourceDocumentsTable.content })
    .from(aiSourceDocumentsTable)
    .where(eq(aiSourceDocumentsTable.sourceType, "blitz_video"));
  const manifest = buildManifestFromCorpus(transcripts);
  console.log(`Manifest: ${manifest.length} docs`);

  const tags = await getEffectiveTags();
  const triggers = await getEffectiveTagTriggers();

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
    } else {
      const taxonomyTags = detectTagsFromTriggers(`${entry.title}\n${content}`, tags, triggers);
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
          taxonomyTags,
          blitzSection: entry.section.id,
          ceiling: "operational",
          phase: entry.section.phase,
          adminNotes: `Section-anchored Blitz reference doc (rebuild): guide section ${entry.section.id} "${entry.section.title}", part ${entry.partIndex}/${entry.partCount}, ${entry.transcripts.length} transcript(s) enriched.`,
        })
        .returning({ id: kbStagingDocsTable.id });
      console.log(`  staged #${stg.id} [${entry.processNode}] tags=${taxonomyTags.join(",") || "-"}`);
    }
    done++;
  }
  console.log(`COMPLETE ${done}/${manifest.length}`);
  process.exit(0);
}
main().catch((e) => { console.error("RUN FAILED (resume by rerunning):", e); process.exit(1); });
