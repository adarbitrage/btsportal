import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, aiLiveDocumentsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { snapshotLiveDocVersion } from "../lib/live-doc-snapshot.js";

// ── Task #2098: concurrent writers must never lose a version snapshot ────────
// Two overlapping transactions each snapshot-then-overwrite the same live doc.
// The seam's advisory lock + FOR UPDATE re-read must serialize them so that
// version history records A then <first writer's output>, with unique,
// sequential version numbers — never two stale snapshots of A.

const TEST_TITLE = "__test__ snapshot concurrency probe (safe to delete)";

let docId: number;

beforeAll(async () => {
  await db.execute(
    sql`DELETE FROM ai_live_documents WHERE title = ${TEST_TITLE}`,
  );
  const [inserted] = await db
    .insert(aiLiveDocumentsTable)
    .values({ title: TEST_TITLE, category: "concepts", content: "A" })
    .returning({ id: aiLiveDocumentsTable.id });
  docId = inserted.id;
});

afterAll(async () => {
  // Hard delete is fine HERE only: this is a synthetic test row (cascade
  // removes its version rows too). Never hard-delete real live docs.
  await db.execute(sql`DELETE FROM ai_live_documents WHERE id = ${docId}`);
});

async function snapshotAndWrite(newContent: string): Promise<void> {
  await db.transaction(async (tx) => {
    await snapshotLiveDocVersion(tx, docId);
    await tx
      .update(aiLiveDocumentsTable)
      .set({ content: newContent, updatedAt: new Date() })
      .where(eq(aiLiveDocumentsTable.id, docId));
  });
}

describe("live-doc snapshot seam under concurrent writers", () => {
  it("two overlapping snapshot+overwrite transactions preserve A then the intermediate state", async () => {
    await Promise.all([snapshotAndWrite("B"), snapshotAndWrite("C")]);

    const versions = await db.execute(
      sql`SELECT version_number, content FROM ai_live_document_versions
          WHERE doc_id = ${docId} ORDER BY version_number`,
    );
    const rows = versions.rows as Array<{ version_number: number; content: string }>;

    // Exactly two snapshots, sequentially numbered, no duplicates.
    expect(rows.map((r) => r.version_number)).toEqual([1, 2]);
    // v1 must be the original state; v2 must be whichever writer won the race
    // (B or C) — NEVER a second stale copy of A.
    expect(rows[0].content).toBe("A");
    expect(["B", "C"]).toContain(rows[1].content);

    const [live] = await db
      .select({ content: aiLiveDocumentsTable.content })
      .from(aiLiveDocumentsTable)
      .where(eq(aiLiveDocumentsTable.id, docId));
    // The final live content is the loser-of-the-snapshot-order's write, and
    // it differs from the last snapshot (v2 preserved the intermediate state).
    expect(["B", "C"]).toContain(live.content);
    expect(live.content).not.toBe(rows[1].content);
  });

  it("a stale caller-supplied row object cannot produce a stale snapshot (helper re-reads)", async () => {
    // Select the row, then mutate it out-of-band, then snapshot passing the
    // STALE object — the recorded snapshot must hold the fresh content.
    const [stale] = await db
      .select()
      .from(aiLiveDocumentsTable)
      .where(eq(aiLiveDocumentsTable.id, docId));
    await db
      .update(aiLiveDocumentsTable)
      .set({ content: "FRESH" })
      .where(eq(aiLiveDocumentsTable.id, docId));

    await db.transaction(async (tx) => {
      await snapshotLiveDocVersion(tx, stale);
    });

    const res = await db.execute(
      sql`SELECT content FROM ai_live_document_versions
          WHERE doc_id = ${docId} ORDER BY version_number DESC LIMIT 1`,
    );
    expect((res.rows[0] as { content: string }).content).toBe("FRESH");
  });
});
