import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { syncCitableDocsToLiveDocuments } from "../lib/bootstrap-critical-prerequisites";

// Regression guard for the AUTHORITATIVE legacy -> ai_live_documents mirror.
//
// The assistant retrieves from `ai_live_documents`, but several paths (admin KB
// CRUD, seeders, kb-flags) keep writing the citable set into legacy
// `knowledgebase_docs`. `syncCitableDocsToLiveDocuments()` reconciles the two.
// It must be authoritative (upsert + prune), NOT append-only: when a legacy doc
// stops being citable (verification cleared / doc_class demoted / deleted), the
// mirror row has to disappear so the assistant stops citing a stale doc. Docs
// published DIRECTLY into ai_live by the staging push (which records a
// kb_doc_provenance row) must survive the prune.

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

describe("syncCitableDocsToLiveDocuments is authoritative (upsert + prune)", () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("mirrors a newly-citable legacy doc, then prunes it when it stops being citable", async () => {
    // A human-verified curated legacy doc becomes citable.
    await db.execute(sql`
      INSERT INTO knowledgebase_docs (title, category, content, audience, doc_class, last_verified)
      VALUES (${MIRROR_TITLE}, 'operations', ${"A verified answer about " + TOKEN}, 'member', 'curated', NOW())
    `);
    await syncCitableDocsToLiveDocuments();
    expect(await aiLiveTitles()).toContain(MIRROR_TITLE);

    // Simulate an admin edit that revokes citability (clear last_verified). The
    // assistant must stop seeing it after the next reconcile — proving prune.
    await db.execute(sql`
      UPDATE knowledgebase_docs SET last_verified = NULL WHERE title = ${MIRROR_TITLE}
    `);
    await syncCitableDocsToLiveDocuments();
    expect(await aiLiveTitles()).not.toContain(MIRROR_TITLE);
  });

  it("prunes the mirror row when the legacy doc is deleted outright", async () => {
    await db.execute(sql`
      INSERT INTO knowledgebase_docs (title, category, content, audience, doc_class, last_verified)
      VALUES (${MIRROR_TITLE}, 'operations', ${"Another verified answer about " + TOKEN}, 'member', 'curated', NOW())
    `);
    await syncCitableDocsToLiveDocuments();
    expect(await aiLiveTitles()).toContain(MIRROR_TITLE);

    await db.execute(sql`DELETE FROM knowledgebase_docs WHERE title = ${MIRROR_TITLE}`);
    await syncCitableDocsToLiveDocuments();
    expect(await aiLiveTitles()).not.toContain(MIRROR_TITLE);
  });

  it("preserves push-published ai_live docs (provenance-backed) across prune", async () => {
    // A doc published DIRECTLY into ai_live by the staging push: it has NO legacy
    // twin, but it DOES get a kb_doc_provenance row. It must survive the prune.
    const inserted = await db.execute<{ id: number }>(sql`
      INSERT INTO ai_live_documents (title, category, content, audience, doc_class, last_verified)
      VALUES (${PUBLISHED_TITLE}, 'operations', ${"A published answer about " + TOKEN}, 'member', 'curated', NOW())
      RETURNING id
    `);
    const docId = inserted.rows[0].id;
    await db.execute(sql`INSERT INTO kb_doc_provenance (doc_id, relation) VALUES (${docId}, 'source')`);

    // Run the reconcile with no matching legacy doc for this title.
    await syncCitableDocsToLiveDocuments();

    // The provenance discriminator keeps it: still present after prune.
    expect(await aiLiveTitles()).toContain(PUBLISHED_TITLE);
  });
});
