-- Companion migration for the kb_doc_provenance table (KB taxonomy
-- foundation). Pure additive table — written idempotently (CREATE TABLE /
-- INDEX IF NOT EXISTS, guarded ADD CONSTRAINT) so it is safe to replay on a DB
-- drizzle-kit push has already created, and so sync-dev-db / post-merge can
-- apply it before the live-schema-drift gate. Depends on kb_transcript_sources
-- (0069) and knowledgebase_docs, so it sorts after them.
CREATE TABLE IF NOT EXISTS "kb_doc_provenance" (
  "id" serial PRIMARY KEY NOT NULL,
  "doc_id" integer NOT NULL,
  "source_id" integer,
  "chunk_ref" text,
  "relation" text DEFAULT 'source' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "kb_doc_provenance"
    ADD CONSTRAINT "kb_doc_provenance_doc_id_knowledgebase_docs_id_fk"
    FOREIGN KEY ("doc_id") REFERENCES "knowledgebase_docs"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "kb_doc_provenance"
    ADD CONSTRAINT "kb_doc_provenance_source_id_kb_transcript_sources_id_fk"
    FOREIGN KEY ("source_id") REFERENCES "kb_transcript_sources"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "kb_doc_provenance_doc_idx"
  ON "kb_doc_provenance" ("doc_id");
CREATE INDEX IF NOT EXISTS "kb_doc_provenance_source_idx"
  ON "kb_doc_provenance" ("source_id");
