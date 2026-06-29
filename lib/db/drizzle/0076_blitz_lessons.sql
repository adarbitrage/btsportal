-- Blitz curriculum lessons — dedicated table, fully decoupled from kb_staging_docs.
--
-- The 94 Blitz lessons previously lived in kb_staging_docs (source='blitz'),
-- sharing the AI knowledge-base review/staging table. They are finished,
-- member-facing training content with nothing to do with the AI review pipeline,
-- so they now own their own table.
--
-- This migration only CREATES the table (idempotent CREATE TABLE IF NOT EXISTS).
-- The data move (copy legacy rows out of kb_staging_docs + remove them there) is
-- performed by an idempotent boot hook (migrateBlitzLessons in the api-server
-- blitz-seed.ts) so it reaches both dev and prod on server boot.

CREATE TABLE IF NOT EXISTS "blitz_lessons" (
  "id"                 serial PRIMARY KEY NOT NULL,
  "title"              text NOT NULL,
  "category"           text NOT NULL DEFAULT 'curriculum',
  "content"            text NOT NULL,
  "tags"               text NOT NULL DEFAULT '',
  "source_video_title" text,
  "source_video_id"    text,
  "status"             text NOT NULL DEFAULT 'published',
  "admin_notes"        text,
  "edited_content"     text,
  "phase"              text,
  "module"             text,
  "lesson_id"          text,
  "lesson_type"        text,
  "network_path"       text,
  "publisher_path"     text,
  "blitz_order"        integer,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "blitz_lessons_order_idx"     ON "blitz_lessons" ("blitz_order");
CREATE INDEX IF NOT EXISTS "blitz_lessons_lesson_id_idx" ON "blitz_lessons" ("lesson_id");
CREATE INDEX IF NOT EXISTS "blitz_lessons_status_idx"    ON "blitz_lessons" ("status");
