import { describe, it, expect } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { seedConceptsLiveDocsForTest } from "./fixtures/concepts-docs.fixture";
import { seedRefundLiveDocsForTest } from "./fixtures/refund-docs.fixture";

// ── Corpus immutability guard (Task #2098) ─────────────────────────────────
//
// INCIDENT: on 2026-08-04 an api-server test run against the shared dev
// database silently overwrote seven rich, human-reviewed Live AI Documents
// with short fixture stubs. Root cause: the retrieval-test fixtures upserted
// by real corpus title with `ON CONFLICT (title) DO UPDATE SET content = ...`,
// bypassing the version-snapshot seam entirely.
//
// CONTRACT enforced here: running the live-doc test fixtures must leave every
// pre-existing row in ai_live_documents BYTE-IDENTICAL — no content change,
// no taxonomy change, no resurrection of soft-deleted rows, no deletion.
// Fixtures may only INSERT rows for titles that do not exist at all (fresh /
// empty databases). If this test fails, a fixture regained a destructive
// write path — fix the fixture, never this test.

type RowFingerprint = {
  id: number;
  fingerprint: string;
};

async function fingerprintAllLiveDocs(): Promise<Map<number, string>> {
  // md5 over every content-bearing / taxonomy / lifecycle column; COALESCE so
  // NULL vs '' changes are visible too.
  const res = await db.execute(sql`
    SELECT id,
           md5(
             coalesce(title, '<null>') || '|' ||
             coalesce(content, '<null>') || '|' ||
             coalesce(category, '<null>') || '|' ||
             coalesce(doc_class, '<null>') || '|' ||
             coalesce(slug, '<null>') || '|' ||
             coalesce(home_root, '<null>') || '|' ||
             coalesce(node, '<null>') || '|' ||
             coalesce(tags::text, '<null>') || '|' ||
             coalesce(audience, '<null>') || '|' ||
             coalesce(last_verified::text, '<null>') || '|' ||
             coalesce(deleted_at::text, '<null>') || '|' ||
             coalesce(updated_at::text, '<null>')
           ) AS fingerprint
    FROM ai_live_documents
  `);
  const map = new Map<number, string>();
  for (const row of res.rows as unknown as RowFingerprint[]) {
    map.set(Number(row.id), String(row.fingerprint));
  }
  return map;
}

describe("live-doc fixtures never mutate existing corpus rows", () => {
  it("running both fixtures leaves every pre-existing live doc byte-identical", async () => {
    const before = await fingerprintAllLiveDocs();

    // Run the fixtures exactly as the retrieval tests do.
    await seedConceptsLiveDocsForTest();
    await seedRefundLiveDocsForTest();

    const after = await fingerprintAllLiveDocs();

    // 1. No pre-existing row deleted.
    // 2. No pre-existing row modified (fingerprint covers content, taxonomy,
    //    soft-delete state, and updated_at — any write flips it).
    const mutated: number[] = [];
    const removed: number[] = [];
    for (const [id, fp] of before) {
      const afterFp = after.get(id);
      if (afterFp === undefined) removed.push(id);
      else if (afterFp !== fp) mutated.push(id);
    }

    expect(
      removed,
      `fixtures DELETED existing live docs (ids: ${removed.join(", ")}) — fixtures must be insert-only`,
    ).toEqual([]);
    expect(
      mutated,
      `fixtures MUTATED existing live docs (ids: ${mutated.join(", ")}) — fixtures must be insert-only (ON CONFLICT DO NOTHING)`,
    ).toEqual([]);

    // Idempotency: a second run must also change nothing (covers the case
    // where the first run inserted rows on a fresh DB).
    const second = await fingerprintAllLiveDocs();
    await seedConceptsLiveDocsForTest();
    await seedRefundLiveDocsForTest();
    const third = await fingerprintAllLiveDocs();
    expect(third.size, "second fixture run changed row count").toBe(second.size);
    for (const [id, fp] of second) {
      expect(third.get(id), `second fixture run mutated live doc ${id}`).toBe(fp);
    }
  });
});
