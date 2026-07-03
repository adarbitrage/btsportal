import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { syncCitableDocsToLiveDocuments } from "../lib/bootstrap-critical-prerequisites";

// Regression guard for the legacy -> ai_live_documents seed (Task #1665).
//
// The assistant retrieves from `ai_live_documents`, which is now the
// AUTHORITATIVE, editable home for its corpus (edited via the review loop, the
// direct escape hatch, or soft-delete). `syncCitableDocsToLiveDocuments()` is a
// FILL-IF-EMPTY seed, NOT an authoritative mirror:
//   1. It INSERTS only docs that are missing (ON CONFLICT (title) DO NOTHING) —
//      it must never overwrite the content of an existing Live AI Document, so
//      approved revisions and manual edits survive every restart.
//   2. It NEVER PRUNES — a legacy revocation must not silently hard-delete a
//      Live AI Document. Retiring a doc is the soft-delete path's job.

const TOKEN = "zzqxreconciletoken";
const MIRROR_TITLE = `Reconcile Mirror ${TOKEN}`;
const PUBLISHED_TITLE = `Reconcile Published ${TOKEN}`;

async function cleanup() {
  await db.execute(sql`DELETE FROM kb_doc_provenance p USING ai_live_documents a
    WHERE p.doc_id = a.id AND a.title LIKE ${"%" + TOKEN + "%"}`);
  await db.execute(sql`DELETE FROM ai_live_documents WHERE title LIKE ${"%" + TOKEN + "%"}`);
  await db.execute(sql`DELETE FROM knowledgebase_docs WHERE title LIKE ${"%" + TOKEN + "%"}`);
}

async function aiLiveTitles(): Promise<string[]> {
  const rows = await db.execute<{ title: string }>(
    sql`SELECT title FROM ai_live_documents WHERE title LIKE ${"%" + TOKEN + "%"}`,
  );
  return (rows.rows ?? []).map((r) => r.title);
}

async function aiLiveContent(title: string): Promise<string | null> {
  const rows = await db.execute<{ content: string }>(
    sql`SELECT content FROM ai_live_documents WHERE title = ${title} LIMIT 1`,
  );
  return rows.rows[0]?.content ?? null;
}

describe("syncCitableDocsToLiveDocuments is a fill-if-empty seed (no overwrite, no prune)", () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("seeds a newly-citable legacy doc that has no Live AI Document yet", async () => {
    await db.execute(sql`
      INSERT INTO knowledgebase_docs (title, category, content, audience, doc_class, last_verified)
      VALUES (${MIRROR_TITLE}, 'operations', ${"A verified answer about " + TOKEN}, 'member', 'curated', NOW())
    `);
    await syncCitableDocsToLiveDocuments();
    expect(await aiLiveTitles()).toContain(MIRROR_TITLE);
  });

  it("never overwrites the content of an existing Live AI Document", async () => {
    // Legacy doc + its seeded mirror.
    await db.execute(sql`
      INSERT INTO knowledgebase_docs (title, category, content, audience, doc_class, last_verified)
      VALUES (${MIRROR_TITLE}, 'operations', ${"Original legacy content " + TOKEN}, 'member', 'curated', NOW())
    `);
    await syncCitableDocsToLiveDocuments();

    // Simulate an admin edit / approved revision applied directly to the Live doc.
    const EDITED = `Admin-edited content ${TOKEN}`;
    await db.execute(sql`UPDATE ai_live_documents SET content = ${EDITED} WHERE title = ${MIRROR_TITLE}`);

    // Legacy content drifts (or a boot re-runs the seed). The edit must survive.
    await db.execute(sql`UPDATE knowledgebase_docs SET content = ${"Legacy changed " + TOKEN} WHERE title = ${MIRROR_TITLE}`);
    await syncCitableDocsToLiveDocuments();

    expect(await aiLiveContent(MIRROR_TITLE)).toBe(EDITED);
  });

  it("does NOT prune a Live AI Document when its legacy source stops being citable", async () => {
    await db.execute(sql`
      INSERT INTO knowledgebase_docs (title, category, content, audience, doc_class, last_verified)
      VALUES (${MIRROR_TITLE}, 'operations', ${"Another verified answer about " + TOKEN}, 'member', 'curated', NOW())
    `);
    await syncCitableDocsToLiveDocuments();
    expect(await aiLiveTitles()).toContain(MIRROR_TITLE);

    // Legacy revocation (verification cleared) then legacy deletion. Neither may
    // hard-delete the Live AI Document — retirement is the soft-delete path.
    await db.execute(sql`UPDATE knowledgebase_docs SET last_verified = NULL WHERE title = ${MIRROR_TITLE}`);
    await syncCitableDocsToLiveDocuments();
    expect(await aiLiveTitles()).toContain(MIRROR_TITLE);

    await db.execute(sql`DELETE FROM knowledgebase_docs WHERE title = ${MIRROR_TITLE}`);
    await syncCitableDocsToLiveDocuments();
    expect(await aiLiveTitles()).toContain(MIRROR_TITLE);
  });

  it("preserves push-published ai_live docs (provenance-backed) across the seed", async () => {
    const inserted = await db.execute<{ id: number }>(sql`
      INSERT INTO ai_live_documents (title, category, content, audience, doc_class, last_verified)
      VALUES (${PUBLISHED_TITLE}, 'operations', ${"A published answer about " + TOKEN}, 'member', 'curated', NOW())
      RETURNING id
    `);
    const docId = inserted.rows[0].id;
    await db.execute(sql`INSERT INTO kb_doc_provenance (doc_id, relation) VALUES (${docId}, 'source')`);

    await syncCitableDocsToLiveDocuments();

    expect(await aiLiveTitles()).toContain(PUBLISHED_TITLE);
  });
});
