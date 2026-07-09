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
  // Multi-source provenance for a Synthesis-Engine draft (Task #1533). Each
  // contributing source: { sourceDocId, sourceType, authorityRole, sourceName,
  // transcriptSourceId, relevance }. Null for single-origin / non-synthesized
  // drafts (their origin lives in sourceId / sourceVideoTitle). Powers the
  // review multi-source provenance panel and the per-source publish provenance.
  synthesisSources: jsonb("synthesis_sources").$type<{
    sourceDocId: number;
    sourceType: string | null;
    authorityRole: string | null;
    sourceName: string | null;
    transcriptSourceId: number | null;
    relevance: number | null;
    // Part 3: true when this source is NEW material (not present at the node's
    // last synthesis) — the provenance that drove a proposed revision.
    isNew?: boolean | null;
  }[]>(),
  // Reviewer parked this draft for a subject-matter expert (could not adjudicate).
  needsExpert: boolean("needs_expert").notNull().default(false),

  // ── Synthesis Engine Part 3: update-vs-create (Task #1535) ─────────────────
  // When synthesis overlaps a topic node that ALREADY has a published Live AI
  // Document, the draft is a REVISION of that doc rather than a brand-new one.
  //   updateKind      — 'new' (default/create, also NULL) | 'update' (supersede).
  //   targetLiveDocId — the ai_live_documents row this revision supersedes
  //                     (soft link; push falls back to create if it's gone).
  //   updateSummary   — human-readable diff: what the new source material adds /
  //                     changes vs the currently-published version.
  updateKind: text("update_kind"),
  targetLiveDocId: integer("target_live_doc_id"),
  updateSummary: text("update_summary"),

  // ── Navigation Docs (Task #1776) ────────────────────────────────────────
  // Declared navigation coverage for a `navigation`-class draft: the fixed
  // vocabulary app slug (kb-nav-vocabulary) + normalized free-form area label.
  // Null for every other doc class. Publishing a nav doc auto-resolves the
  // matching open kb_nav_gap_flags row.
  navApp: text("nav_app"),
  navArea: text("nav_area"),
  // Authoring-input screenshots (object-storage paths) the vision model drafted
  // from. Audit only — never retrieved at answer time.
  navScreenshots: jsonb("nav_screenshots").$type<string[]>(),

  // ── Navigation grounding (Task #1778) ──────────────────────────────────────
  // Content-hash version of the portal nav map (@workspace/portal-nav-map) the
  // draft was synthesized against. Nullable: only AI-synthesized truth drafts
  // are stamped. The boot-time nav drift scan compares this against the current
  // map version to find drafts written against an outdated navigation.
  navMapVersion: text("nav_map_version"),

  // ── Retrieval self-test (Task #1804) ────────────────────────────────────
  // Result of the "will the assistant find this doc?" self-test run during AI
  // analysis: the model's member-phrased questions each run through the REAL
  // shared hybrid retrieval path (vs live docs) plus ad-hoc draft scoring
  // (draft embeddings are NEVER stored — computed per run and discarded).
  // Shape: { ranAt, semanticAvailable, memberQuestions, results:[{question,
  // draftLexRank, draftSemanticScore, clearsFloor, wouldSurface, passed,
  // topLiveTitle, topLiveLexRank, topLiveSemanticScore }], passedCount,
  // failedCount }. Null = never self-tested.
  retrievalSelfTest: jsonb("retrieval_self_test"),

  // ── AI title suggestion lifecycle (Task #1839) ───────────────────────────
  // Decision state for the AI-suggested title (aiCleanedTitle):
  //   null        — pending (no decision yet; analysis may regenerate it)
  //   'accepted'  — reviewer applied the suggestion to `title`
  //   'dismissed' — reviewer rejected it; the stored title stands
  //   'edited'    — a human edited the title directly
  // Once non-null, re-analysis never regenerates the suggestion.
  aiTitleDecision: text("ai_title_decision"),

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

// ── Navigation-map version snapshots (Task #1778) ────────────────────────────
// One row per DISTINCT portal nav-map version ever seen at boot (content hash
// of @workspace/portal-nav-map). The stored snapshot lets the boot-time drift
// scan diff the OLD map against the current one when the version changes, and
// flag truth docs that reference a changed location for re-verification.
export const kbNavMapVersionsTable = pgTable("kb_nav_map_versions", {
  id: serial("id").primaryKey(),
  version: text("version").notNull().unique(),
  // Flattened NavItem[] snapshot: [{ label, path, description, entitlement? }].
  snapshot: jsonb("snapshot")
    .$type<{ label: string; path: string; description: string; entitlement?: string }[]>()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KbNavMapVersion = typeof kbNavMapVersionsTable.$inferSelect;
