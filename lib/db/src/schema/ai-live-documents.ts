import {
  pgTable,
  text,
  serial,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Postgres `tsvector` column type. drizzle-kit has no first-class tsvector, so we
// declare it via customType. The value is GENERATED ALWAYS by Postgres (see
// `searchVector` below) — never written by the application.
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// pgvector `vector(1536)` column (text-embedding-3-small dimension). Stored as
// its Postgres text representation ("[0.1,0.2,...]"); the application always
// reads/writes it via raw SQL with an explicit ::vector cast, never through
// drizzle value mapping.
const vector1536 = customType<{ data: string }>({
  dataType() {
    return "vector(1536)";
  },
});

// ── Live AI Documents (AI Knowledgebase) ─────────────────────────────────────
// The cleanly-separated home for the AI assistant's citable corpus (Task #1531).
// Brought to full parity with the legacy dual-purpose `knowledgebase_docs` so the
// chat + voice retrieval paths and the staging→publish flow can read/write here
// with ZERO behavior change. The legacy table stays the source for the
// member-facing Knowledge Base (`/kb/search`, browse, counts, bookmarks); a boot
// sync mirrors the human-verified citable set into this table.
//
// Full-text search: a STORED generated `search_vector` (to_tsvector over
// title||' '||content — the exact expression every retrieval query uses) plus a
// PLAIN GIN index over that column. This deliberately avoids the drizzle-kit
// ^0.31.9 expression-GIN codegen bug (it emits a malformed `tsvector_ops`
// statement Postgres rejects) by indexing a real column instead of an expression.
export const aiLiveDocumentsTable = pgTable(
  "ai_live_documents",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    // Stable machine identity, separate from the editable display `title`.
    // Unique (multiple NULLs allowed for rows authored without an explicit slug).
    slug: text("slug"),
    category: text("category").notNull().default("faq"),
    content: text("content").notNull(),
    // Member vs admin visibility — every retrieval path filters `audience <> 'admin'`.
    audience: text("audience").notNull().default("member"),
    // Deep-link back into the portal for member-facing citations.
    sourcePath: text("source_path"),
    sourceLabel: text("source_label"),
    // doc_class: 'curated' | 'overview' | 'transcript'. A doc is CITABLE only when
    // doc_class IN ('curated','overview') AND last_verified IS NOT NULL.
    docClass: text("doc_class"),
    // Home root / node slugs within the kb-taxonomy registry (plain text).
    homeRoot: text("home_root"),
    node: text("node"),
    // Cross-cutting concept / tool / troubleshooting tags (registry-controlled).
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    // Blitz lifecycle. Guarded by the Blitz→node drift test.
    blitzSection: integer("blitz_section"),
    // Depth ceiling: how deep this doc is allowed to go before handing off.
    ceiling: text("ceiling"),
    // Where to hand off when the ceiling is hit (e.g. 'coaching' | 'support').
    handoff: text("handoff"),
    // Free-text reviewer notes (Task #1851). Set from the KB review screen when a
    // reviewer, refining a different draft, opts to leave a note on THIS live doc
    // (e.g. "an overlap on X was flagged elsewhere — fold it in on next edit").
    // Append-only in practice; surfaced to the future editor of this doc. NULL =
    // no notes. Landed additively (ADD COLUMN IF NOT EXISTS) — see post-merge.sh.
    reviewerNotes: text("reviewer_notes"),
    // Declared navigation coverage (Task #1776) — set only on `navigation`-class
    // docs: fixed-vocabulary app slug + normalized area label. Publishing a nav
    // doc auto-resolves the matching open kb_nav_gap_flags row.
    navApp: text("nav_app"),
    navArea: text("nav_area"),
    // Human-verification stamp — the citable gate. NULL = held / not yet citable.
    lastVerified: timestamp("last_verified", { withTimezone: true }),
    // Soft-delete tombstone (Task #1665). NULL = live. When set, the doc is
    // excluded from every retrieval path but the row (and its version history)
    // is preserved so an admin can restore it. Nothing is ever hard-deleted.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // Automated "source changed" signal (Task #1665). Stamped when a scan detects
    // that the source material feeding this doc's topic node materially changed,
    // so the admin UI can badge it "likely needs updating". Cleared when an
    // approved revision supersedes the doc (or the admin dismisses the flag).
    flaggedStaleAt: timestamp("flagged_stale_at", { withTimezone: true }),
    flaggedReason: text("flagged_reason"),
    // Semantic-retrieval embedding (Task #1803). NULL = not yet embedded (doc
    // participates in lexical ranking only — graceful degradation by design).
    // Written ONLY by the embedding seam (lib/kb-embeddings.ts); the model
    // column lets a future model swap invalidate + re-backfill cleanly.
    // Landed in dev+prod via the boot-time ADD COLUMN IF NOT EXISTS hook
    // (CREATE EXTENSION vector cannot ride drizzle push).
    embedding: vector1536("embedding"),
    embeddingModel: text("embedding_model"),
    embeddingGeneratedAt: timestamp("embedding_generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // STORED full-text vector. Identical expression to what every retrieval query
    // computes inline, so `search_vector @@ q` / `ts_rank(search_vector, q)` are
    // byte-for-byte equivalent to the previous inline `to_tsvector(...)` form.
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', title || ' ' || content)`,
    ),
  },
  (table) => [
    uniqueIndex("ai_live_documents_slug_uniq").on(table.slug),
    // Title unique so the staging push + citable boot sync can upsert on title.
    uniqueIndex("ai_live_documents_title_uniq").on(table.title),
    index("ai_live_documents_doc_class_idx").on(table.docClass),
    index("ai_live_documents_home_root_idx").on(table.homeRoot),
    index("ai_live_documents_search_idx").using("gin", table.searchVector),
  ],
);

// NOTE: `searchVector` is a GENERATED ALWAYS column — drizzle-zod already omits
// it from the insert schema, so listing it in `.omit()` throws
// "Unrecognized key: searchVector" under zod v4. Only omit the DB-managed
// identity/timestamp columns here.
export const insertAiLiveDocumentSchema = createInsertSchema(aiLiveDocumentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiLiveDocument = z.infer<typeof insertAiLiveDocumentSchema>;
export type AiLiveDocument = typeof aiLiveDocumentsTable.$inferSelect;
