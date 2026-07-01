import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiSourceDocumentsTable } from "./ai-source-documents";

/**
 * Per-source, per-node MAP-phase extract cache for the Synthesis Engine
 * (Task #1561).
 *
 * The synthesis map phase now reads the WHOLE of every source (windowed, no
 * 6k truncation) and pulls out the material relevant to a taxonomy node — an
 * expensive multi-LLM-call step for long transcripts. Because the reduce phase
 * re-runs whenever a node's linked source set changes (incremental runs), those
 * extracts would be recomputed on every run even for sources whose content
 * didn't change. This table caches the finished per-(source, node) extract so
 * an incremental re-run only re-extracts sources whose content actually changed.
 *
 * Invalidation is content-addressed: `contentFingerprint` is a hash of the
 * source document's content at extraction time. A cache hit requires BOTH the
 * (source_doc_id, node) match AND a fingerprint match — if the source content
 * changed, the fingerprint differs and the extract is recomputed.
 *
 * One row per (source document, node). `node` is plain text owned by the
 * api-server kb-taxonomy registry (not a pg enum), consistent with the rest of
 * the KB schema. Additive/nullable — nothing depends on a row existing; a miss
 * simply triggers a fresh extraction. Rows cascade-delete with their source.
 */
export const kbSourceNodeExtractsTable = pgTable("kb_source_node_extracts", {
  id: serial("id").primaryKey(),
  // The source document the extract was pulled from.
  sourceDocId: integer("source_doc_id")
    .notNull()
    .references(() => aiSourceDocumentsTable.id, { onDelete: "cascade" }),
  // Taxonomy node the extract is relevant to.
  node: text("node").notNull(),
  // Hash of the source content at extraction time — the cache invalidation key.
  contentFingerprint: text("content_fingerprint").notNull(),
  // The finished map-phase extract (may be the literal "NONE" marker when the
  // source has nothing usable for this node — cached so it isn't recomputed).
  extract: text("extract").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("kb_source_node_extracts_node_idx").on(table.node),
  // At most one cached extract per (source document, node).
  uniqueIndex("kb_source_node_extracts_source_node_unq").on(table.sourceDocId, table.node),
]);

export const insertKbSourceNodeExtractSchema = createInsertSchema(kbSourceNodeExtractsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKbSourceNodeExtract = z.infer<typeof insertKbSourceNodeExtractSchema>;
export type KbSourceNodeExtract = typeof kbSourceNodeExtractsTable.$inferSelect;
