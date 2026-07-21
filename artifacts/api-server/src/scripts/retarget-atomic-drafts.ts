/**
 * One-off follow-up to dedup-atomic-drafts.ts: pending synthesis atomic drafts
 * still marked updateKind='new' whose CONCEPT already exists as a live doc are
 * retargeted as updates to that doc (same concept-key matcher the synthesis
 * insert path now uses). If two pending drafts end up targeting the same live
 * doc, only the best is kept (reviewer-edited > newest); the rest are
 * soft-deleted with an audit note.
 *
 * Usage: tsx retarget-atomic-drafts.ts [--apply]   (default dry-run)
 */
import { db, pool } from "@workspace/db";
import { kbStagingDocsTable, aiLiveDocumentsTable } from "@workspace/db/schema";
import { sql, eq } from "drizzle-orm";
import { conceptKeys, keysIntersect } from "../lib/kb-duplicates.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const drafts = await db
    .select({
      id: kbStagingDocsTable.id,
      title: kbStagingDocsTable.title,
      editedContent: kbStagingDocsTable.editedContent,
      updateKind: kbStagingDocsTable.updateKind,
      targetLiveDocId: kbStagingDocsTable.targetLiveDocId,
      adminNotes: kbStagingDocsTable.adminNotes,
    })
    .from(kbStagingDocsTable)
    .where(sql`
      ${kbStagingDocsTable.status} = 'needs_review'
      AND ${kbStagingDocsTable.originType} = 'ai_synthesized'
      AND ${kbStagingDocsTable.title} ILIKE 'What is %'
    `);
  const liveDocs = await db
    .select({ id: aiLiveDocumentsTable.id, title: aiLiveDocumentsTable.title })
    .from(aiLiveDocumentsTable)
    .where(sql`
      ${aiLiveDocumentsTable.docClass} IN ('curated','overview')
      AND ${aiLiveDocumentsTable.lastVerified} IS NOT NULL
      AND ${aiLiveDocumentsTable.audience} <> 'admin'
      AND ${aiLiveDocumentsTable.deletedAt} IS NULL
      AND ${aiLiveDocumentsTable.title} ILIKE 'What is %'
    `);
  const liveKeys = liveDocs.map((d) => ({ ...d, keys: conceptKeys(d.title) }));

  // Pass 1: retarget concept matches.
  const byTarget = new Map<number, typeof drafts>();
  for (const d of drafts) {
    let target = d.targetLiveDocId;
    if (d.updateKind === "new" && target == null) {
      const keys = conceptKeys(d.title);
      const match = liveKeys.find((l) => keysIntersect(keys, l.keys));
      if (match) {
        target = match.id;
        console.log(`RETARGET #${d.id} "${d.title}" -> live #${match.id} "${match.title}"`);
        if (APPLY) {
          await db
            .update(kbStagingDocsTable)
            .set({
              updateKind: "update",
              targetLiveDocId: match.id,
              updateSummary: `Proposed revision of the published doc "${match.title}" (retargeted by concept-level dedup cleanup).`,
            })
            .where(eq(kbStagingDocsTable.id, d.id));
        }
      }
    }
    if (target != null) {
      const list = byTarget.get(target) ?? [];
      list.push(d);
      byTarget.set(target, list);
    }
  }

  // Pass 2: collapse multiple drafts targeting the same live doc.
  for (const [target, list] of byTarget) {
    if (list.length < 2) continue;
    const keeper =
      list.find((d) => d.editedContent !== null) ?? list.reduce((a, b) => (b.id > a.id ? b : a));
    for (const l of list) {
      if (l.id === keeper.id) continue;
      console.log(`COLLAPSE #${l.id} "${l.title}" (same live target #${target} as kept #${keeper.id})`);
      if (APPLY) {
        const note = `Auto-dedup ${new Date().toISOString().slice(0, 10)}: duplicate update of live doc #${target}; kept draft #${keeper.id}.`;
        await db
          .update(kbStagingDocsTable)
          .set({ status: "deleted", adminNotes: l.adminNotes ? `${l.adminNotes}\n${note}` : note })
          .where(eq(kbStagingDocsTable.id, l.id));
      }
    }
  }
  console.log(`\n[retarget] done (${APPLY ? "applied" : "dry-run"}).`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("[retarget] fatal:", err);
  try { await pool.end(); } catch { /* noop */ }
  process.exit(1);
});
