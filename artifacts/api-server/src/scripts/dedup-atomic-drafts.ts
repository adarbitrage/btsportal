/**
 * One-off cleanup: cluster still-pending synthesis-created atomic drafts
 * ("What is X?") by concept and soft-delete the redundant ones, keeping the
 * best draft per cluster. Keep priority: reviewer-edited > targets a live doc
 * (updateKind=update) > newest (highest id). Soft delete = status 'deleted'
 * (same convention as the Possible-Duplicates surface) with an audit note —
 * content is never destroyed.
 *
 * Usage: tsx dedup-atomic-drafts.ts [--apply]   (default is dry-run)
 */
import { db, pool } from "@workspace/db";
import { kbStagingDocsTable } from "@workspace/db/schema";
import { sql, eq } from "drizzle-orm";
import { clusterDuplicates } from "../lib/kb-duplicates.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await db
    .select({
      id: kbStagingDocsTable.id,
      title: kbStagingDocsTable.title,
      content: kbStagingDocsTable.content,
      editedContent: kbStagingDocsTable.editedContent,
      targetLiveDocId: kbStagingDocsTable.targetLiveDocId,
      adminNotes: kbStagingDocsTable.adminNotes,
    })
    .from(kbStagingDocsTable)
    .where(sql`
      ${kbStagingDocsTable.status} = 'needs_review'
      AND ${kbStagingDocsTable.originType} = 'ai_synthesized'
      AND ${kbStagingDocsTable.title} ILIKE 'What is %'
    `);
  console.log(`[dedup] pending atomic drafts: ${rows.length}`);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const clusters = clusterDuplicates(
    rows.map((r) => ({ id: r.id, title: r.title, content: r.editedContent ?? r.content })),
  );
  console.log(`[dedup] duplicate clusters: ${clusters.length}`);

  let deleted = 0;
  for (const cluster of clusters) {
    const docs = cluster.docIds.map((id) => byId.get(id)!);
    const keeper =
      docs.find((d) => d.editedContent !== null) ??
      docs.find((d) => d.targetLiveDocId !== null) ??
      docs.reduce((a, b) => (b.id > a.id ? b : a));
    const losers = docs.filter((d) => d.id !== keeper.id);
    console.log(`\n[cluster] "${cluster.key}"`);
    console.log(`  KEEP   #${keeper.id} "${keeper.title}"${keeper.targetLiveDocId ? ` (updates live doc #${keeper.targetLiveDocId})` : ""}${keeper.editedContent !== null ? " (reviewer-edited)" : ""}`);
    for (const l of losers) {
      console.log(`  DELETE #${l.id} "${l.title}"`);
      if (APPLY) {
        const note = `Auto-dedup ${new Date().toISOString().slice(0, 10)}: duplicate of kept draft #${keeper.id} (concept: ${cluster.key}).`;
        await db
          .update(kbStagingDocsTable)
          .set({
            status: "deleted",
            adminNotes: l.adminNotes ? `${l.adminNotes}\n${note}` : note,
          })
          .where(eq(kbStagingDocsTable.id, l.id));
        deleted++;
      }
    }
  }
  console.log(`\n[dedup] ${APPLY ? "soft-deleted" : "would soft-delete"} ${APPLY ? deleted : clusters.reduce((n, c) => n + c.docIds.length - 1, 0)} drafts across ${clusters.length} clusters.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("[dedup] fatal:", err);
  try { await pool.end(); } catch { /* noop */ }
  process.exit(1);
});
