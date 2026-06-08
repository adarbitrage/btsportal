/**
 * Re-scrub every knowledgebase_docs row through the centralized privacy
 * filter (lib/content-privacy-filter.ts).
 *
 * Why: rows seeded BEFORE a privacy rule was widened keep their stale,
 * unscrubbed text — fixing the filter only protects NEW ingestion. This
 * one-shot re-applies the current rules to existing rows so a coach surname
 * variant that slipped in earlier (e.g. the single-s "Wisbaum") gets cleaned.
 *
 * Idempotent and safe to re-run: only rows whose content OR title actually
 * changes are updated.
 *
 * TITLES carry a UNIQUE constraint (knowledgebase_docs_title_uniq), so naively
 * writing a scrubbed title can collide two rows onto the same value and abort
 * the whole run. We handle that safely:
 *   - The scrubbed title is trimmed (the orphan-surname rules can leave a
 *     leading/trailing space).
 *   - If the scrubbed title would collide with another row's title (already in
 *     the DB or another row scrubbed in this same run), we de-duplicate by
 *     appending a numeric suffix — "Foo", "Foo (2)", "Foo (3)" — picking the
 *     first free slot. The suffixed title contains no coach surname, so a
 *     re-run scrubs it to itself and makes no further change (still idempotent).
 *   - If a title scrubs down to nothing (e.g. it was only the forbidden word),
 *     we fall back to a stable "Untitled (#id)" so the NOT NULL/UNIQUE
 *     constraints still hold.
 *
 * The kb-coach-name-leak-guard DB test scans titles too, so cleaning titles
 * here closes the last manual gap. Operates on the database the env points to.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/rescrub-knowledgebase-docs.ts
 */
import { db, knowledgebaseDocsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { scrubPrivateContent } from "../lib/content-privacy-filter";

/**
 * Compute the scrubbed title for a row, resolving UNIQUE collisions against
 * `taken` (the set of titles currently live, mutated as we go). Returns the
 * final title that is safe to persist. Does NOT mutate `taken` — the caller
 * decides whether the update succeeded before reserving the new value.
 */
function resolveTitle(
  rowId: number,
  scrubbed: string,
  taken: Set<string>,
): string {
  let base = scrubbed.trim();
  if (base === "") base = `Untitled (#${rowId})`;

  if (!taken.has(base)) return base;

  // Collision: find the first free "base (n)" slot.
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

export interface RescrubResult {
  scanned: number;
  contentUpdated: number;
  titleUpdated: number;
}

/**
 * Re-scrub every knowledgebase_docs row. Returns counts. Idempotent: a second
 * call with no new offending content/titles makes zero writes. Safe to import
 * from tests (does not call process.exit).
 */
export async function rescrubKnowledgebaseDocs(
  log: (msg: string) => void = () => {},
): Promise<RescrubResult> {
  const rows = await db
    .select({
      id: knowledgebaseDocsTable.id,
      title: knowledgebaseDocsTable.title,
      content: knowledgebaseDocsTable.content,
    })
    .from(knowledgebaseDocsTable);

  log(`[rescrub] scanning ${rows.length} knowledgebase_docs rows...`);

  // Every title currently live, used to detect UNIQUE collisions as we rewrite.
  const taken = new Set(rows.map((r) => r.title));

  let contentUpdated = 0;
  let titleUpdated = 0;
  for (const row of rows) {
    const cleanContent = scrubPrivateContent(row.content);
    const cleanTitleRaw = scrubPrivateContent(row.title);

    const contentChanged = cleanContent !== row.content;
    const titleChanged = cleanTitleRaw.trim() !== row.title;

    if (!contentChanged && !titleChanged) continue;

    const set: { content?: string; title?: string } = {};
    if (contentChanged) set.content = cleanContent;

    let finalTitle = row.title;
    if (titleChanged) {
      // Free this row's own current title so it can't collide with itself,
      // then resolve a safe (collision-free) target.
      taken.delete(row.title);
      finalTitle = resolveTitle(row.id, cleanTitleRaw, taken);
      taken.add(finalTitle);
      set.title = finalTitle;
    }

    await db
      .update(knowledgebaseDocsTable)
      .set(set)
      .where(eq(knowledgebaseDocsTable.id, row.id));

    if (contentChanged) contentUpdated++;
    if (titleChanged) {
      titleUpdated++;
      log(`[rescrub] retitled #${row.id} "${row.title}" -> "${finalTitle}"`);
    } else {
      log(`[rescrub] cleaned #${row.id} "${row.title}"`);
    }
  }

  log(
    `[rescrub] done. ${contentUpdated} content + ${titleUpdated} title update(s) across ${rows.length} rows.`,
  );
  return { scanned: rows.length, contentUpdated, titleUpdated };
}

// Run directly as a CLI script (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  rescrubKnowledgebaseDocs((m) => console.log(m))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[rescrub] failed:", err);
      process.exit(1);
    });
}
