import { pgTable, text, serial, integer, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * The Transcript Cleaner holding store (Task #1468).
 *
 * Raw call transcripts (uploaded by hand in any format, or pre-populated by the
 * separate import task) land here, get AI-cleaned (speaker re-attribution,
 * authority labelling, glossary/terminology fixes, cruft strip, suggested
 * title), and sit in a HOLDING AREA for admin review + refinement chat before
 * being FILED into the AI Source Knowledge library (`ai_source_documents`).
 *
 * This is deliberately DISTINCT from the curated Document Review pipeline
 * (`kb_staging_docs`): cleaned transcripts are raw SOURCE material, never
 * citable truth, so they must never route through staging. The original input
 * is preserved unchanged in `originalContent`; cleanup always produces a new
 * cleaned copy in `cleanedContent`.
 *
 * Vocabularies are plain `text` (owned by the api-server kb-taxonomy registry,
 * not pg enums) so they can grow without a schema migration:
 *  - transcriptType:  the destination folder slug (one of the seven SOURCE_FOLDERS).
 *  - authorityRole:   'strategic_coach' | 'va' | 'curriculum' | 'internal'.
 *  - status:          'uploaded' | 'cleaning' | 'cleaned' | 'filed' | 'error'.
 *  - authorityConfidence: 'high' | 'low' (null until cleaned).
 */
export const transcriptCleanerDocumentsTable = pgTable("transcript_cleaner_documents", {
  id: serial("id").primaryKey(),
  // The chosen title used as the filename when filed. Always editable.
  title: text("title").notNull().default(""),
  // The AI-suggested title (authority + call type + date/time).
  suggestedTitle: text("suggested_title"),
  // An approved title carried in from the import task (plan #1484). When present
  // the suggestion is OFFERED, not auto-applied.
  proposedTitle: text("proposed_title"),
  // True when the date/time could not be determined from content/source, so the
  // admin must supply it. Surfaced as a title flag in the UI.
  titleNeedsInput: boolean("title_needs_input").notNull().default(false),
  // Destination folder slug — one of the seven SOURCE_FOLDERS (kb-taxonomy).
  // Null until the admin tags it.
  transcriptType: text("transcript_type"),
  // The raw input, preserved unchanged.
  originalContent: text("original_content").notNull(),
  // The AI-cleaned output. Null until cleaned.
  cleanedContent: text("cleaned_content"),
  // Resolved authority role (mirrors ai_source_documents.authority_role).
  authorityRole: text("authority_role"),
  // 'high' (roster-name match or strong inference) | 'low' (flag for review).
  authorityConfidence: text("authority_confidence"),
  // Free-form evidence supporting the authority mapping.
  authorityEvidence: text("authority_evidence"),
  // Admin-supplied cleaning inputs, captured at upload (batch default or
  // per-file override) BEFORE cleaning. They are the ground truth for WHO/WHAT
  // (Task #1560): the AI only decides WHICH turns belong to the authority.
  // All nullable — an unset value falls back to a call-type default / AI guess.
  //  - providedAuthorityRole: 'strategic_coach' | 'va' | 'curriculum' | 'internal'.
  //  - providedAuthorityName: the authority's name when a roster coach/VA is picked.
  //  - providedSubject:       the member / topic subject for the title.
  //  - providedDate:          the call date (any string containing an ISO date).
  providedAuthorityRole: text("provided_authority_role"),
  providedAuthorityName: text("provided_authority_name"),
  providedSubject: text("provided_subject"),
  providedDate: text("provided_date"),
  // Structured low-confidence segments / review flags: [{ type, text, reason, confidence }].
  flags: jsonb("flags").$type<TranscriptCleanerFlag[]>().notNull().default(sql`'[]'::jsonb`),
  // Refinement chat turns: [{ role: 'user' | 'assistant', content }].
  chatHistory: jsonb("chat_history").$type<TranscriptCleanerChatTurn[]>().notNull().default(sql`'[]'::jsonb`),
  // Lifecycle status.
  status: text("status").notNull().default("uploaded"),
  // Provenance: original filename / recording name.
  sourceName: text("source_name"),
  // Provenance: free-form note carried onto the filed source doc.
  provenanceNote: text("provenance_note"),
  // For multi-video lessons (e.g. Blitz captions auto-recognized on upload),
  // the video's 1-based order within its lesson, so the sequence is preserved.
  // Null for transcripts that have no in-lesson ordering.
  inLessonOrder: integer("in_lesson_order"),
  // The source Vidalytics video id, captured (and safety-net cleaned) from a
  // recognized Blitz caption filename. Stored as real, queryable data — the
  // single key that links this transcript to EVERY Blitz lesson the video
  // appears in (the placements are derived live from the Blitz guide, so they
  // adapt when the guide changes). Null for non-Blitz transcripts.
  vidalyticsId: text("vidalytics_id"),
  // Soft link to ai_source_documents.id once filed (no hard FK).
  filedSourceDocId: integer("filed_source_doc_id"),
  filedAt: timestamp("filed_at", { withTimezone: true }),
  // Last cleaning/refinement error, surfaced in the UI.
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("transcript_cleaner_documents_status_idx").on(table.status),
  index("transcript_cleaner_documents_transcript_type_idx").on(table.transcriptType),
]);

export interface TranscriptCleanerFlag {
  /** e.g. 'low_confidence_attribution' | 'ambiguous_speaker' | 'title_date' | 'general'. */
  type: string;
  /** The transcript snippet / item the flag refers to (optional). */
  text?: string;
  /** Why it was flagged. */
  reason: string;
  /** 'low' for review-needed items. */
  confidence?: string;
}

export interface TranscriptCleanerChatTurn {
  role: "user" | "assistant";
  content: string;
}

export const insertTranscriptCleanerDocumentSchema = createInsertSchema(transcriptCleanerDocumentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTranscriptCleanerDocument = z.infer<typeof insertTranscriptCleanerDocumentSchema>;
export type TranscriptCleanerDocument = typeof transcriptCleanerDocumentsTable.$inferSelect;
