import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * The AI Source Knowledge library — the RAW-SOURCE layer behind the assistant.
 *
 * This is the clean, type-organised home for the AI's raw training material
 * (cleaned transcripts from the Transcript Cleaner + reference material). It is
 * deliberately DISTINCT from both:
 *   - the legacy live `knowledgebase_docs` table (the current retrieval corpus), and
 *   - the curated `ai_live_documents` corpus (citable truth).
 * Source documents are MINING INPUT, never citable, and are not wired into any
 * member-facing retrieval path.
 *
 * Organised into seven folders by source type (see `SOURCE_FOLDERS` in the
 * api-server kb-taxonomy registry): five transcript/video types — Group
 * Coaching, Private Coaching, 1-on-1 VA, Blitz Video, Other Video — and two
 * document types — Reference Docs, Other Docs.
 *
 * Vocabularies are deliberately plain `text` (owned by the kb-taxonomy
 * registry, not pg enums) so folders/roles can grow without a schema migration:
 *  - sourceType:    the folder slug (one of the seven `SOURCE_FOLDERS`).
 *  - authorityRole: mirrors `kb_transcript_sources.authority_role` —
 *                   'strategic_coach' | 'va' | 'curriculum' | 'internal'.
 *
 * Provenance (where the doc came from) is captured as a free-form origin name
 * plus an optional soft link back to the `kb_transcript_sources` registry row
 * the content was mined from (no hard FK — the source layer stays decoupled).
 */
export const aiSourceDocumentsTable = pgTable("ai_source_documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  // Folder slug — one of the seven SOURCE_FOLDERS (kb-taxonomy).
  sourceType: text("source_type").notNull(),
  // Mirrors kb_transcript_sources.authority_role. Conservative default.
  authorityRole: text("authority_role").notNull().default("internal"),
  // Provenance: the origin recording / file / document name.
  sourceName: text("source_name"),
  // Provenance: optional soft link to kb_transcript_sources.id (no hard FK).
  sourceId: integer("source_id"),
  // Provenance: free-form note explaining where this came from / how it was mined.
  provenanceNote: text("provenance_note"),
  // Synthesis Engine Part 2 (Task #1534): the last time this source was folded
  // into a node synthesis. NULL = never incorporated (a brand-new source the
  // incremental run should classify + route to its affected nodes).
  incorporatedAt: timestamp("incorporated_at", { withTimezone: true }),
  // Blitz change-monitoring foundation (Task #1564): a content fingerprint
  // (sha256 hex of `content`) captured the last time this source was scanned.
  // NULL = never scanned. The dormant "Scan for changes" flow refreshes each
  // core-training source's content, recomputes this hash, and flags a source as
  // changed when the new hash differs from the stored one — so it can propose an
  // AI-reference-doc revision through the existing supersede path. Additive.
  contentHash: text("content_hash"),
  // The last time this source was examined by the change scan (independent of
  // whether it changed). NULL = never scanned.
  lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("ai_source_documents_source_type_idx").on(table.sourceType),
  index("ai_source_documents_authority_role_idx").on(table.authorityRole),
]);

export const insertAiSourceDocumentSchema = createInsertSchema(aiSourceDocumentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiSourceDocument = z.infer<typeof insertAiSourceDocumentSchema>;
export type AiSourceDocument = typeof aiSourceDocumentsTable.$inferSelect;
