-- Task #2 (AI Truth-Doc Authoring & Review Pipeline) companion migration.
--
-- The pipeline task added taxonomy + screening/risk columns to kb_staging_docs
-- and a durable processed-marker (last_mined_at) to kb_transcript_sources, but
-- shipped them as a "dev ALTER only" change with no companion .sql. On merge the
-- shared dev DB fell behind the schema, so the live-schema-drift gate in
-- post-merge fails and falls back to a full `drizzle-kit push --force` (which, on
-- this DB, hangs/aborts on an interactive "truncate coaching_calls?" prompt under
-- the non-TTY post-merge). Applying these additive columns explicitly here keeps
-- the drift gate green so push stays skipped — same pattern as steps 4-11.
--
-- Every statement is idempotent (ADD COLUMN/INDEX IF NOT EXISTS, guarded ADD
-- CONSTRAINT), so re-running against an already-migrated DB is a safe no-op, and
-- on a fresh DB where push-force creates the table in its final shape it no-ops.

-- ── kb_staging_docs: Task #2 taxonomy + risk-flag fields ─────────────────────
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "home_root" text;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "node" text;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "taxonomy_tags" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "doc_class_target" text;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "blitz_section" integer;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "ceiling" text;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "handoff" text;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "doc_type" text NOT NULL DEFAULT 'truth_draft';
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "origin_type" text;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "authority_role" text;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "source_id" integer;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "risk_flags" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "corroboration_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "conflict_data" jsonb;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "stale_references" jsonb;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "ai_suggested_taxonomy" jsonb;
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "needs_expert" boolean NOT NULL DEFAULT false;

-- FK: source_id -> kb_transcript_sources(id) ON DELETE SET NULL. Guarded so a
-- re-run (or a push that already created it) does not error on the duplicate.
DO $$ BEGIN
  ALTER TABLE "kb_staging_docs"
    ADD CONSTRAINT "kb_staging_docs_source_id_kb_transcript_sources_id_fk"
    FOREIGN KEY ("source_id") REFERENCES "kb_transcript_sources"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Indexes backing the new taxonomy/screening facets.
CREATE INDEX IF NOT EXISTS "kb_staging_home_root_idx" ON "kb_staging_docs" ("home_root");
CREATE INDEX IF NOT EXISTS "kb_staging_node_idx" ON "kb_staging_docs" ("node");
CREATE INDEX IF NOT EXISTS "kb_staging_doc_type_idx" ON "kb_staging_docs" ("doc_type");
CREATE INDEX IF NOT EXISTS "kb_staging_origin_type_idx" ON "kb_staging_docs" ("origin_type");
CREATE INDEX IF NOT EXISTS "kb_staging_source_fk_idx" ON "kb_staging_docs" ("source_id");

-- ── kb_transcript_sources: durable "already-mined" marker ────────────────────
ALTER TABLE "kb_transcript_sources" ADD COLUMN IF NOT EXISTS "last_mined_at" timestamp with time zone;
