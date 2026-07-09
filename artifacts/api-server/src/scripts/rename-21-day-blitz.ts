/**
 * One-off idempotent backfill: rename "21 Day Blitz" (and variants) to
 * "the Blitz" in synthesized/curated KB output tables:
 *   - kb_staging_docs (title + content)
 *   - ai_live_documents (title + content)
 *
 * Raw source transcripts and the YSE product catalog are deliberately NOT
 * touched (see the out-of-scope list in the task plan). Uses the shared
 * rebrandOldBrandContent rules so the rewrite matches exactly what future
 * synthesis / retrieval passes apply. Re-running is a no-op.
 *
 * Run: npx tsx artifacts/api-server/src/scripts/rename-21-day-blitz.ts
 */
import { db, kbStagingDocsTable, aiLiveDocumentsTable } from "@workspace/db";
import { eq, or, ilike } from "drizzle-orm";
import { rebrandOldBrandContent } from "../lib/content-privacy-filter";
import { CLEARED_EMBEDDING_FIELDS } from "../lib/kb-embeddings.js";

async function rewriteTable(
  label: string,
  table: typeof kbStagingDocsTable | typeof aiLiveDocumentsTable,
): Promise<void> {
  const rows = await db
    .select({ id: table.id, title: table.title, content: table.content })
    .from(table)
    .where(or(ilike(table.content, "%21%blitz%"), ilike(table.title, "%21%blitz%")));

  let changed = 0;
  for (const row of rows) {
    const newTitle = rebrandOldBrandContent(row.title);
    const newContent = rebrandOldBrandContent(row.content);
    if (newTitle === row.title && newContent === row.content) continue;
    if (table === aiLiveDocumentsTable) {
      // A content rewrite makes any stored semantic embedding stale — clear it
      // ATOMICALLY in the same update; the boot backfill regenerates it.
      await db
        .update(aiLiveDocumentsTable)
        .set({ title: newTitle, content: newContent, ...CLEARED_EMBEDDING_FIELDS })
        .where(eq(aiLiveDocumentsTable.id, row.id));
    } else {
      await db
        .update(table)
        .set({ title: newTitle, content: newContent })
        .where(eq(table.id, row.id));
    }
    changed++;
    console.log(`[rename-21-day-blitz] ${label} id=${row.id}: "${row.title}" -> "${newTitle}"`);
  }
  console.log(`[rename-21-day-blitz] ${label}: ${rows.length} candidate rows, ${changed} rewritten`);
}

async function main(): Promise<void> {
  await rewriteTable("kb_staging_docs", kbStagingDocsTable);
  await rewriteTable("ai_live_documents", aiLiveDocumentsTable);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[rename-21-day-blitz] FAILED:", err);
    process.exit(1);
  });
