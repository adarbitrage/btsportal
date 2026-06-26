import { pgTable, text, serial, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const knowledgebaseDocsTable = pgTable("knowledgebase_docs", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("faq"),
  content: text("content").notNull(),
  // Visibility flag. `member` docs are eligible for AI Assistant / voice /
  // member chat retrieval; `admin` docs are internal-only and MUST be excluded
  // from every member-facing retrieval path. Additive NOT NULL with a default
  // so existing rows stay member-visible.
  audience: text("audience").notNull().default("member"),
  searchVector: text("search_vector"),
  // Deep-link back to the originating portal page (member-facing path).
  // Nullable — existing rows and admin docs have no portal destination.
  sourcePath: text("source_path"),
  // Human-readable label for the source (e.g. "Blitz Guide", "Resource Library").
  sourceLabel: text("source_label"),

  // ── AI-assistant remediation taxonomy (Task #1 foundation) ────────────────
  // All columns below are additive/nullable so existing rows keep working. The
  // node/tag/home-root vocabularies are deliberately plain `text` (not pg
  // enums) so the taxonomy can evolve as data without a schema migration — the
  // controlled vocabulary lives in the api-server kb-taxonomy registry.
  //
  // doc_class: 'curated' | 'overview' | 'transcript'. Transcript-derived rows
  // are training-only and excluded from every member-facing retrieval path.
  // A doc is CITABLE only when doc_class IN ('curated','overview') AND
  // lastVerified IS NOT NULL — so the citable set starts empty and is rebuilt
  // from human-verified docs.
  docClass: text("doc_class"),
  // Stable machine identity, separate from the editable display `title`.
  // Unique (multiple NULLs allowed for un-migrated rows).
  slug: text("slug"),
  // Exactly one home root per doc: 'process' | 'concepts' | 'operations'.
  // NULL un-migrated rows fall back to the registry DEFAULT_HOME_ROOT at read.
  homeRoot: text("home_root"),
  // Node slug within the home root (see kb-taxonomy registry).
  node: text("node"),
  // Cross-cutting concept / tool / troubleshooting tags (registry-controlled).
  tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // Mapping to a Blitz curriculum section id (1..23) when the doc hugs the
  // Blitz lifecycle. Guarded by the Blitz→node drift test.
  blitzSection: integer("blitz_section"),
  // Depth ceiling: how deep this doc is allowed to go before handing off.
  ceiling: text("ceiling"),
  // Where to hand off when the ceiling is hit (e.g. 'coaching' | 'support').
  handoff: text("handoff"),
  // When a human last verified this doc is accurate + current. NULL = held as
  // a re-verification draft (not yet citable).
  lastVerified: timestamp("last_verified", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("knowledgebase_docs_search_idx").using("gin", sql`to_tsvector('english', ${table.title} || ' ' || ${table.content})`),
  uniqueIndex("knowledgebase_docs_title_uniq").on(table.title),
  uniqueIndex("knowledgebase_docs_slug_uniq").on(table.slug),
  index("knowledgebase_docs_doc_class_idx").on(table.docClass),
  index("knowledgebase_docs_home_root_idx").on(table.homeRoot),
]);

export const insertKnowledgebaseDocSchema = createInsertSchema(knowledgebaseDocsTable).omit({ id: true, searchVector: true, createdAt: true, updatedAt: true });
export type InsertKnowledgebaseDoc = z.infer<typeof insertKnowledgebaseDocSchema>;
export type KnowledgebaseDoc = typeof knowledgebaseDocsTable.$inferSelect;
