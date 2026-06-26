import { sql, type SQL } from "drizzle-orm";
import { CITABLE_DOC_CLASSES } from "./kb-taxonomy";

/**
 * SQL boolean fragment gating which knowledgebase_docs rows may appear in a
 * member-facing AI answer (chat / voice / RAG retriever).
 *
 * A doc is CITABLE only when:
 *   - its `doc_class` is a citable class (curated / overview) — this excludes
 *     `transcript` training material outright; AND
 *   - a human has verified it (`last_verified IS NOT NULL`).
 *
 * This realises the pre-launch clean slate: with every row currently held
 * (last_verified NULL), the citable set starts effectively empty and is rebuilt
 * only from human-verified docs. Combine with the existing `audience <> 'admin'`
 * guard at each call site (kept separate so admin-only docs stay excluded even
 * if a future class becomes citable).
 *
 * Returns a fresh fragment each call so it can be safely embedded in multiple
 * queries without sharing a parameter list.
 */
export function citableDocFilter(): SQL {
  const classes = sql.join(
    CITABLE_DOC_CLASSES.map((c) => sql`${c}`),
    sql`, `,
  );
  return sql`doc_class IN (${classes}) AND last_verified IS NOT NULL`;
}
