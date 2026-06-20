import { pgTable, text, serial, timestamp, integer, index, real } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

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
