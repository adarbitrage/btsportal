import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// TEST-ONLY fixture helper (Task #1826). The production boot mirror that copied
// citable legacy `knowledgebase_docs` rows into `ai_live_documents` has been
// RETIRED — in production the only writers of ai_live_documents are the staging
// review push and the admin Live AI Documents CRUD. Several retrieval tests
// still author their fixtures via the legacy seed hooks (which write the legacy
// table), so they use this helper to place the citable set into
// ai_live_documents directly. It intentionally lives in __tests__ so it can
// never be imported by server code.
export async function seedLiveDocsFromCitableLegacyForTest(): Promise<void> {
  await db.execute(sql`
    INSERT INTO ai_live_documents
      (title, slug, category, content, audience, source_path, source_label,
       doc_class, home_root, node, tags, blitz_section, ceiling, handoff,
       last_verified, created_at, updated_at)
    SELECT
      k.title, k.slug, k.category, k.content, k.audience, k.source_path, k.source_label,
      k.doc_class, k.home_root, k.node, k.tags, k.blitz_section, k.ceiling, k.handoff,
      k.last_verified, k.created_at, k.updated_at
    FROM knowledgebase_docs k
    WHERE k.doc_class IN ('curated', 'overview') AND k.last_verified IS NOT NULL
    ON CONFLICT (title) DO NOTHING`);
}
