import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiSourceDocumentsTable } from "./ai-source-documents";

/**
 * Per-source run record for the coaching-transcript VALUE SCREENER
 * (Task #1702) — the value-screening layer that sits BETWEEN the existing
 * source-level screening/mining gates and the synthesis engine.
 *
 * One row per screened source (a cleared coaching-call source document). It
 * records:
 *  - the DEDUP verdict for the whole source (exact content-hash match or a
 *    near-duplicate of an earlier source), and
 *  - the content-fingerprint cache stamp so an unchanged source is not
 *    re-screened.
 *
 * Cache invalidation mirrors the kb_source_node_extracts pattern: a screening
 * is fresh while `contentFingerprint` still matches the source's current
 * content; a content change makes it stale and it is re-run.
 *
 * `dedupStatus` and `valueType`/`disposition` (on kb_screened_exchanges) are
 * deliberately plain `text` (a small closed vocabulary owned by the api-server
 * kb-value-screener module, NOT pg enums), consistent with the rest of the KB
 * schema so the vocabulary can grow without a migration.
 *
 * Nothing here is auto-published. The screened representation (the KEPT
 * exchanges on kb_screened_exchanges) is what the later topic-index/extract
 * phase reads; the raw `ai_source_documents.content` is retained untouched for
 * audit. Rows cascade-delete with their source document.
 */
export const kbCallScreeningsTable = pgTable("kb_call_screenings", {
  id: serial("id").primaryKey(),
  // The source document (a cleared coaching-call source) that was screened.
  sourceDocId: integer("source_doc_id")
    .notNull()
    .references(() => aiSourceDocumentsTable.id, { onDelete: "cascade" }),
  // Hash of the source content at screening time — the content-side cache key.
  contentFingerprint: text("content_fingerprint").notNull(),
  // Whole-source dedup verdict: 'unique' | 'exact_duplicate' | 'near_duplicate'.
  dedupStatus: text("dedup_status").notNull().default("unique"),
  // Normalized-content hash used for exact-duplicate detection (post
  // whitespace/case normalization; distinct from the raw contentFingerprint).
  normalizedHash: text("normalized_hash").notNull(),
  // When this source is a duplicate/near-duplicate, the source document id it
  // duplicates (the earlier/kept one). NULL when unique.
  duplicateOfSourceId: integer("duplicate_of_source_id"),
  // Similarity (0..1, x1000 int) to duplicateOfSourceId for near-duplicates.
  similarityScore: integer("similarity_score"),
  // Roll-up counts across this source's segments (audit / preview headline).
  // The errored count is derived: exchangeCount - kept - dropped - flagged.
  exchangeCount: integer("exchange_count").notNull().default(0),
  keptCount: integer("kept_count").notNull().default(0),
  droppedCount: integer("dropped_count").notNull().default(0),
  flaggedCount: integer("flagged_count").notNull().default(0),
  // Anomaly-signal inputs persisted at screening time (see computeAnomalyFlags
  // in the api-server kb-value-screener module): the longest segment passage
  // (chars) and the source content length (chars). A screening with an
  // oversized segment or implausibly few segments for its length is flagged
  // for admin attention rather than silently passing.
  maxSegmentChars: integer("max_segment_chars").notNull().default(0),
  sourceCharCount: integer("source_char_count").notNull().default(0),
  // How many segments were closed by the EMERGENCY size ceiling rather than a
  // topic boundary (Task #1742) — >0 raises the "emergency_split" anomaly.
  emergencySplitCount: integer("emergency_split_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // At most one screening row per source document (re-runs UPSERT in place).
  uniqueIndex("kb_call_screenings_source_unq").on(table.sourceDocId),
  index("kb_call_screenings_dedup_idx").on(table.dedupStatus),
]);

export const insertKbCallScreeningSchema = createInsertSchema(kbCallScreeningsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKbCallScreening = z.infer<typeof insertKbCallScreeningSchema>;
export type KbCallScreening = typeof kbCallScreeningsTable.$inferSelect;
