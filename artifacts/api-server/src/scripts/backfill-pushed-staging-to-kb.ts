/**
 * One-shot backfill: copies kb_staging_docs rows that are status='pushed'
 * (sources: blitz, coaching_call) into knowledgebase_docs as upserts on title.
 *
 * Safe to re-run: uses ON CONFLICT (title) DO UPDATE.
 * Only operates on the database the env points to. To run against prod, set
 * the prod DATABASE_URL in this process's environment.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/backfill-pushed-staging-to-kb.ts
 */
import { db } from "@workspace/db";
import { kbStagingDocsTable, knowledgebaseDocsTable } from "@workspace/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

const SOURCES = ["blitz", "coaching_call"] as const;

async function main() {
  console.log("[backfill] reading pushed staging docs...");
  const pushed = await db
    .select()
    .from(kbStagingDocsTable)
    .where(
      and(
        eq(kbStagingDocsTable.status, "pushed"),
        inArray(kbStagingDocsTable.source, SOURCES as unknown as string[]),
      ),
    );

  console.log(`[backfill] found ${pushed.length} pushed staging docs to backfill`);

  if (pushed.length === 0) {
    const [{ cnt }] = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(knowledgebaseDocsTable);
    console.log(`[backfill] knowledgebase_docs current row count: ${cnt}`);
    console.log("[backfill] nothing to backfill. exiting.");
    process.exit(0);
  }

  const bySource = pushed.reduce<Record<string, number>>((acc, r) => {
    acc[r.source ?? "unknown"] = (acc[r.source ?? "unknown"] ?? 0) + 1;
    return acc;
  }, {});
  console.log("[backfill] by source:", bySource);

  let inserted = 0;
  let updated = 0;

  await db.transaction(async (tx) => {
    for (const doc of pushed) {
      const content = doc.editedContent ?? doc.content;
      const result = await tx.execute(
        sql`INSERT INTO knowledgebase_docs (title, category, content)
            VALUES (${doc.title}, ${doc.category}, ${content})
            ON CONFLICT (title) DO UPDATE
              SET category = EXCLUDED.category,
                  content = EXCLUDED.content,
                  updated_at = NOW()
            RETURNING (xmax = 0) AS inserted`,
      );
      const wasInserted = (result.rows[0] as { inserted: boolean })?.inserted;
      if (wasInserted) inserted++;
      else updated++;
    }
  });

  const [{ cnt }] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(knowledgebaseDocsTable);

  console.log(`[backfill] done. inserted=${inserted} updated=${updated}`);
  console.log(`[backfill] knowledgebase_docs row count is now: ${cnt}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] FATAL:", err);
  process.exit(1);
});
