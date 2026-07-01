import { pgTable, serial, integer, text, real, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiSourceDocumentsTable } from "./ai-source-documents";

/**
 * Topic index — the persisted source→taxonomy-node relevance layer that powers
 * the Synthesis Engine (Task #1533).
 *
 * The AI Source Knowledge library (`ai_source_documents`) is organised by
 * source-TYPE folder, not by topic, and there is no semantic search in the repo
 * (retrieval is lexical tsvector). To consolidate all material relevant to a
 * taxonomy node ACROSS the whole corpus, synthesis needs a topic layer. Rather
 * than introduce pgvector, this is a persisted classification layer: an LLM
 * (with a lexical fallback) assigns each source document to one or more
 * taxonomy nodes with a relevance score, and those assignments live here.
 *
 * A single source document may be relevant to several nodes (a coaching call
 * that covers both "angles" and "testing methodology"), so this is a genuine
 * many-to-many link table — one row per (sourceDocId, node).
 *
 * Vocabularies are plain `text` owned by the api-server kb-taxonomy registry
 * (not pg enums), consistent with the rest of the KB schema:
 *  - homeRoot: one of HOME_ROOTS.
 *  - node:     one of ALL_NODES (belongs to homeRoot).
 *  - method:   how the link was derived — 'llm' | 'lexical'.
 */
export const kbSourceNodeLinksTable = pgTable("kb_source_node_links", {
  id: serial("id").primaryKey(),
  // The source document being classified.
  sourceDocId: integer("source_doc_id")
    .notNull()
    .references(() => aiSourceDocumentsTable.id, { onDelete: "cascade" }),
  // Taxonomy target this source is relevant to.
  homeRoot: text("home_root").notNull(),
  node: text("node").notNull(),
  // 0..1 relevance the classifier assigned (how central this node is to the doc).
  relevance: real("relevance").notNull().default(0),
  // How the link was derived: 'llm' (classification pass) or 'lexical' (fallback).
  method: text("method").notNull().default("llm"),
  // Short free-text rationale the classifier gave (why this node fits).
  rationale: text("rationale"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("kb_source_node_links_node_idx").on(table.node),
  index("kb_source_node_links_source_idx").on(table.sourceDocId),
  // At most one link per (source document, node).
  uniqueIndex("kb_source_node_links_source_node_unq").on(table.sourceDocId, table.node),
]);

export const insertKbSourceNodeLinkSchema = createInsertSchema(kbSourceNodeLinksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKbSourceNodeLink = z.infer<typeof insertKbSourceNodeLinkSchema>;
export type KbSourceNodeLink = typeof kbSourceNodeLinksTable.$inferSelect;
