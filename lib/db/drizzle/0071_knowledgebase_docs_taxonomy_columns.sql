-- Companion migration for the AI-assistant taxonomy columns added to
-- knowledgebase_docs (KB taxonomy foundation). All additive/nullable (tags is
-- NOT NULL but ships with a DEFAULT so existing rows backfill cleanly), so this
-- is safe to apply on a populated table. Written idempotently
-- (ADD COLUMN / CREATE INDEX IF NOT EXISTS) so it can replay on a DB
-- drizzle-kit push has already migrated, and so sync-dev-db / post-merge can
-- apply it before the live-schema-drift gate (keeping the gate green and push
-- skipped).
ALTER TABLE "knowledgebase_docs" ADD COLUMN IF NOT EXISTS "doc_class" text;
ALTER TABLE "knowledgebase_docs" ADD COLUMN IF NOT EXISTS "slug" text;
ALTER TABLE "knowledgebase_docs" ADD COLUMN IF NOT EXISTS "home_root" text;
ALTER TABLE "knowledgebase_docs" ADD COLUMN IF NOT EXISTS "node" text;
ALTER TABLE "knowledgebase_docs" ADD COLUMN IF NOT EXISTS "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "knowledgebase_docs" ADD COLUMN IF NOT EXISTS "blitz_section" integer;
ALTER TABLE "knowledgebase_docs" ADD COLUMN IF NOT EXISTS "ceiling" text;
ALTER TABLE "knowledgebase_docs" ADD COLUMN IF NOT EXISTS "handoff" text;
ALTER TABLE "knowledgebase_docs" ADD COLUMN IF NOT EXISTS "last_verified" timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS "knowledgebase_docs_slug_uniq"
  ON "knowledgebase_docs" ("slug");
CREATE INDEX IF NOT EXISTS "knowledgebase_docs_doc_class_idx"
  ON "knowledgebase_docs" ("doc_class");
CREATE INDEX IF NOT EXISTS "knowledgebase_docs_home_root_idx"
  ON "knowledgebase_docs" ("home_root");
