/**
 * Re-scrub every knowledgebase_docs row through the centralized privacy
 * filter (lib/content-privacy-filter.ts).
 *
 * Why: rows seeded BEFORE a privacy rule was widened keep their stale,
 * unscrubbed text — fixing the filter only protects NEW ingestion. This
 * one-shot re-applies the current rules to existing rows so a coach surname
 * variant that slipped in earlier (e.g. the single-s "Wisbaum") gets cleaned.
 *
 * Idempotent and safe to re-run: only rows whose content actually changes
 * are updated. Titles are intentionally left untouched — they carry a UNIQUE
 * constraint and scrubbing them can collide two rows onto the same title;
 * the leak guard still scans titles, so a coach surname in a title surfaces
 * as a test failure for manual handling. Operates on the database the env
 * points to.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/rescrub-knowledgebase-docs.ts
 */
import { db, knowledgebaseDocsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { scrubPrivateContent } from "../lib/content-privacy-filter";

async function main() {
  const rows = await db
    .select({
      id: knowledgebaseDocsTable.id,
      title: knowledgebaseDocsTable.title,
      content: knowledgebaseDocsTable.content,
    })
    .from(knowledgebaseDocsTable);

  console.log(`[rescrub] scanning ${rows.length} knowledgebase_docs rows...`);

  let updated = 0;
  for (const row of rows) {
    const cleanContent = scrubPrivateContent(row.content);
    if (cleanContent === row.content) continue;

    await db
      .update(knowledgebaseDocsTable)
      .set({ content: cleanContent })
      .where(eq(knowledgebaseDocsTable.id, row.id));
    updated++;
    console.log(`[rescrub] cleaned #${row.id} "${row.title}"`);
  }

  console.log(`[rescrub] done. Updated ${updated} of ${rows.length} rows.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[rescrub] failed:", err);
  process.exit(1);
});
