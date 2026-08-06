/**
 * One-off restoration (Task #2098): restore live docs overwritten by the
 * 2026-08-04 test-fixture incident from their latest PUBLISHED (human-approved)
 * staging rows, re-applying the exact push-time transform:
 *   scrubPrivateContent(edited_content ?? content)
 *
 * Per doc, in one transaction: snapshot current state into version history →
 * write restored content (clearing embeddings atomically) → verify hash.
 * Then re-embed synchronously.
 *
 * Approved mapping (user-approved manifest, 2026-08-06):
 *   live 7  ← staging 1609   live 10 ← staging 1539
 *   live 8  ← staging 1619   live 11 ← staging 1543
 *   live 9  ← staging 1306   live 20 ← staging 1547
 *   live 10621 ← staging 1523 (adopt reviewed title AND content; the doc was
 *   fixture-created on Aug 4; #1523 is the reviewed Angles doc whose live
 *   counterpart was deleted)
 *
 * Run: npx tsx src/scripts/restore-live-docs-2098.ts
 */
import crypto from "crypto";
import { db, aiLiveDocumentsTable, kbStagingDocsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { scrubPrivateContent } from "../lib/content-privacy-filter";
import { CLEARED_EMBEDDING_FIELDS, embedLiveDocument, isEmbeddingConfigured } from "../lib/kb-embeddings.js";
import { snapshotLiveDocVersion } from "../lib/live-doc-snapshot.js";

const PLAN: Array<{ liveId: number; stagingId: number; adoptTitle?: boolean }> = [
  { liveId: 7, stagingId: 1609 },
  { liveId: 8, stagingId: 1619 },
  { liveId: 9, stagingId: 1306 },
  { liveId: 10, stagingId: 1539 },
  { liveId: 11, stagingId: 1543 },
  { liveId: 20, stagingId: 1547 },
  { liveId: 10621, stagingId: 1523, adoptTitle: true },
];

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

async function main(): Promise<void> {
  for (const { liveId, stagingId, adoptTitle } of PLAN) {
    const [staged] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, stagingId));
    if (!staged) throw new Error(`staging doc ${stagingId} not found`);
    if (staged.status !== "published") {
      throw new Error(`staging doc ${stagingId} status=${staged.status}, expected published — aborting`);
    }
    const restoredContent = scrubPrivateContent(staged.editedContent ?? staged.content);
    const restoredTitle = adoptTitle ? scrubPrivateContent(staged.title) : undefined;
    const expectedHash = md5(restoredContent);

    await db.transaction(async (tx) => {
      const [live] = await tx
        .select()
        .from(aiLiveDocumentsTable)
        .where(eq(aiLiveDocumentsTable.id, liveId))
        .for("update");
      if (!live) throw new Error(`live doc ${liveId} not found`);
      if (live.content === restoredContent && (!restoredTitle || live.title === restoredTitle)) {
        console.log(`live ${liveId}: already restored, skipping`);
        return;
      }
      await snapshotLiveDocVersion(tx, live, { supersededByStagingDocId: stagingId });
      await tx
        .update(aiLiveDocumentsTable)
        .set({
          content: restoredContent,
          ...(restoredTitle ? { title: restoredTitle } : {}),
          updatedAt: new Date(),
          ...CLEARED_EMBEDDING_FIELDS,
        })
        .where(eq(aiLiveDocumentsTable.id, liveId));
      const check = await tx.execute(
        sql`SELECT md5(content) AS h, length(content) AS len, title FROM ai_live_documents WHERE id = ${liveId}`,
      );
      const row = check.rows[0] as { h: string; len: number; title: string };
      if (row.h !== expectedHash) throw new Error(`live ${liveId}: post-write hash mismatch — rolling back`);
      console.log(
        `live ${liveId}: restored from staging ${stagingId} — ${row.len} chars, hash ${row.h.slice(0, 12)}, title "${row.title}"`,
      );
    });
  }

  if (isEmbeddingConfigured()) {
    for (const { liveId } of PLAN) {
      const ok = await embedLiveDocument(liveId);
      console.log(`live ${liveId}: re-embed ${ok ? "ok" : "FAILED (lexical-only until boot backfill)"}`);
    }
  } else {
    console.log("embeddings not configured — boot backfill will regenerate");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("RESTORE FAILED:", err);
    process.exit(1);
  });
