import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { knowledgebaseDocsTable } from "./knowledgebase-docs";
import { kbTranscriptSourcesTable } from "./kb-transcript-sources";

/**
 * Provenance join: links a knowledgebase doc to the transcript source chunk(s)
 * it was derived from / corroborated by. Lets downstream review (Task #2) and
 * conflict adjudication trace a citable claim back to its origin and weigh it
 * by the source's authority role.
 *
 * `sourceId` is nullable so a doc authored from scratch (no transcript origin)
 * can still record provenance metadata. `relation` is plain text — 'source'
 * (derived from), 'corroborates', 'contradicts' — vocabulary owned by the
 * api-server kb-taxonomy registry, not a pg enum.
 */
export const kbDocProvenanceTable = pgTable("kb_doc_provenance", {
  id: serial("id").primaryKey(),
  docId: integer("doc_id").notNull().references(() => knowledgebaseDocsTable.id, { onDelete: "cascade" }),
  sourceId: integer("source_id").references(() => kbTranscriptSourcesTable.id, { onDelete: "set null" }),
  // Pointer into the source (e.g. transcript line range, chunk id, timestamp).
  chunkRef: text("chunk_ref"),
  relation: text("relation").notNull().default("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("kb_doc_provenance_doc_idx").on(table.docId),
  index("kb_doc_provenance_source_idx").on(table.sourceId),
]);

export const insertKbDocProvenanceSchema = createInsertSchema(kbDocProvenanceTable).omit({ id: true, createdAt: true });
export type InsertKbDocProvenance = z.infer<typeof insertKbDocProvenanceSchema>;
export type KbDocProvenance = typeof kbDocProvenanceTable.$inferSelect;
