import { pgTable, text, serial, timestamp, integer, boolean, jsonb, index, real } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { kbTranscriptSourcesTable } from "./kb-transcript-sources";

export const kbStagingDocsTable = pgTable("kb_staging_docs", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("curriculum"),
  content: text("content").notNull(),
  tags: text("tags").notNull().default(""),
  sourceVideoTitle: text("source_video_title"),
  sourceVideoId: text("source_video_id"),
  status: text("status").notNull().default("pending_review"),
  adminNotes: text("admin_notes"),
  editedContent: text("edited_content"),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  mergedIntoId: integer("merged_into_id"),
  source: text("source"),
  phase: text("phase"),
  module: text("module"),
  lessonId: text("lesson_id"),
  lessonType: text("lesson_type"),
  networkPath: text("network_path"),
  publisherPath: text("publisher_path"),
  blitzOrder: integer("blitz_order"),
  // AI triage fields (added in 0060_kb_staging_ai_triage.sql)
  aiConfidenceScore: real("ai_confidence_score"),
  aiRecommendedAction: text("ai_recommended_action"),
  aiSuggestedCategory: text("ai_suggested_category"),
  aiCleanedTitle: text("ai_cleaned_title"),
  aiSummary: text("ai_summary"),
  autoAction: text("auto_action"),
  autoActionAt: timestamp("auto_action_at", { withTimezone: true }),
  autoActionConfidence: real("auto_action_confidence"),
  // ── Task #2 taxonomy + risk-flag fields ──────────────────────────────────
  // All additive/nullable (or NOT NULL with a default) so existing staging rows
  // keep working. The controlled vocabularies live in the api-server
  // kb-taxonomy registry (plain text, no pg enums) so they can evolve as data.
  //
  // Taxonomy target the reviewer sets/confirms before a draft is published.
  homeRoot: text("home_root"),
  node: text("node"),
  // Registry-controlled concept/tool/troubleshooting tags (jsonb, distinct from
  // the legacy free-text `tags` column above which stays for back-compat).
  taxonomyTags: jsonb("taxonomy_tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // Target doc_class once published: 'curated' | 'overview'. (Transcript drafts
  // are never published as 'transcript' — that class is training-only.)
  docClassTarget: text("doc_class_target"),
  blitzSection: integer("blitz_section"),
  ceiling: text("ceiling"),
  handoff: text("handoff"),
  // Work-type facet (primary, alongside shelf/node): the kind of review work.
  //   'truth_draft'   — AI-authored truth doc mined from transcripts (full read).
  //   'existing_doc'  — a Task #1 hand-written doc being re-verified/filed (light).
  //   'study_material'— supporting/training reference.
  docType: text("doc_type").notNull().default("truth_draft"),
  // Clean origin (replaces the inconsistent legacy `source` values):
  //   'strategy_coaching_call' | 'va_call' | 'training_video' | 'curated_upload'
  //   | 'ai_synthesized' | 'manual_entry'.
  originType: text("origin_type"),
  // Authority of the originating source, inherited from kb_transcript_sources:
  //   'strategic_coach' | 'va' | 'curriculum' | 'internal'.
  authorityRole: text("authority_role"),
  // FK to the screened transcript source this draft was mined from (nullable for
  // uploads / manual / AI-synthesized drafts with no single recording origin).
  sourceId: integer("source_id").references(() => kbTranscriptSourcesTable.id, { onDelete: "set null" }),
  // Computed checkable risk flags (NOT a confidence score). Array of flag codes
  // — see api-server kb-flags registry (conflict, single_source, corroborated,
  // high_stakes, possible_duplicate, weak_source, stale_legacy, va_strategy_claim).
  riskFlags: jsonb("risk_flags")
    .$type<{ type: string; severity: string; message: string; detail?: string }[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  // How many distinct sources corroborate this draft (count, not a score).
  corroborationCount: integer("corroboration_count").notNull().default(0),
  // Conflict-adjudication payload: { sentences:[{text,sources:[]}],
  // resolved:bool, canonicalSourceId, supersededSourceIds:[] } — null when no
  // conflict detected.
  conflictData: jsonb("conflict_data"),
  // Old-vs-new legacy reference translations: [{ old, proposed, applied:bool }].
  staleReferences: jsonb("stale_references"),
  // AI's suggested taxonomy (suggestion only; human confirms): { homeRoot, node,
  // tags:[], docClass, blitzSection, ceiling, handoff }.
  aiSuggestedTaxonomy: jsonb("ai_suggested_taxonomy"),
  // Reviewer parked this draft for a subject-matter expert (could not adjudicate).
  needsExpert: boolean("needs_expert").notNull().default(false),

  // Upload-specific fields (added alongside the KB upload feature)
  audience: text("audience").notNull().default("member"),
  sourceObjectPath: text("source_object_path"),
  // Live progress for async upload processing (status === "processing").
  // Holds a human-readable stage label like "Transcribing…" / "Extracting text…" / "Running AI triage…".
  processingStage: text("processing_stage"),
  processingError: text("processing_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("kb_staging_status_idx").on(table.status),
  index("kb_staging_search_idx").using("gin", sql`to_tsvector('english', ${table.title} || ' ' || ${table.content})`),
  index("kb_staging_source_idx").on(table.source),
  index("kb_staging_phase_idx").on(table.phase),
  index("kb_staging_home_root_idx").on(table.homeRoot),
  index("kb_staging_node_idx").on(table.node),
  index("kb_staging_doc_type_idx").on(table.docType),
  index("kb_staging_origin_type_idx").on(table.originType),
  index("kb_staging_source_fk_idx").on(table.sourceId),
]);

export type KbStagingDoc = typeof kbStagingDocsTable.$inferSelect;
export type InsertKbStagingDoc = typeof kbStagingDocsTable.$inferInsert;

// Immutable audit trail — every auto-triage event is INSERT-only; undo appends
// an 'undone' row rather than deleting or clearing the original record.
export const kbTriageAuditLogTable = pgTable("kb_triage_audit_log", {
  id: serial("id").primaryKey(),
  stagingDocId: integer("staging_doc_id").notNull().references(() => kbStagingDocsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // 'auto_approved' | 'auto_rejected' | 'needs_review' | 'undone'
  confidenceScore: real("confidence_score"),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  aiReasoning: text("ai_reasoning"),
  docTitle: text("doc_title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("kb_triage_audit_doc_idx").on(table.stagingDocId),
  index("kb_triage_audit_created_idx").on(table.createdAt),
]);

export type KbTriageAuditLogEntry = typeof kbTriageAuditLogTable.$inferSelect;
