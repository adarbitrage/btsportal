-- Companion migration for the kb_transcript_sources table (KB taxonomy
-- foundation). Pure additive table — written idempotently (CREATE TABLE /
-- INDEX IF NOT EXISTS) so it is safe to replay on a DB drizzle-kit push has
-- already created, and so sync-dev-db / post-merge can apply it before the
-- live-schema-drift gate (keeping the gate green and push skipped).
CREATE TABLE IF NOT EXISTS "kb_transcript_sources" (
  "id" serial PRIMARY KEY NOT NULL,
  "source_name" text NOT NULL,
  "source_kind" text DEFAULT 'unknown' NOT NULL,
  "coach_name" text,
  "disposition" text DEFAULT 'quarantined' NOT NULL,
  "authority_role" text DEFAULT 'internal' NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "kb_transcript_sources_name_uniq"
  ON "kb_transcript_sources" ("source_name");
CREATE INDEX IF NOT EXISTS "kb_transcript_sources_disposition_idx"
  ON "kb_transcript_sources" ("disposition");
CREATE INDEX IF NOT EXISTS "kb_transcript_sources_role_idx"
  ON "kb_transcript_sources" ("authority_role");
