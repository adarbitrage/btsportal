-- Task #1531: bring ai_live_documents to parity with legacy knowledgebase_docs
-- and repoint the kb_doc_provenance FK onto it. Pure additive + FK swap, written
-- idempotently (ADD COLUMN / INDEX IF NOT EXISTS, guarded ADD CONSTRAINT) so it
-- is safe to replay on a DB drizzle-kit push has already created and so
-- sync-dev-db / post-merge can apply it before the live-schema-drift gate.

-- Parity columns (mirror knowledgebase_docs).
ALTER TABLE ai_live_documents
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'member';
--> statement-breakpoint
ALTER TABLE ai_live_documents
  ADD COLUMN IF NOT EXISTS source_path text;
--> statement-breakpoint
ALTER TABLE ai_live_documents
  ADD COLUMN IF NOT EXISTS source_label text;
--> statement-breakpoint
ALTER TABLE ai_live_documents
  ADD COLUMN IF NOT EXISTS doc_class text;
--> statement-breakpoint
ALTER TABLE ai_live_documents
  ADD COLUMN IF NOT EXISTS home_root text;
--> statement-breakpoint
ALTER TABLE ai_live_documents
  ADD COLUMN IF NOT EXISTS node text;
--> statement-breakpoint
ALTER TABLE ai_live_documents
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE ai_live_documents
  ADD COLUMN IF NOT EXISTS blitz_section integer;
--> statement-breakpoint
ALTER TABLE ai_live_documents
  ADD COLUMN IF NOT EXISTS ceiling text;
--> statement-breakpoint
ALTER TABLE ai_live_documents
  ADD COLUMN IF NOT EXISTS handoff text;
--> statement-breakpoint
ALTER TABLE ai_live_documents
  ADD COLUMN IF NOT EXISTS last_verified timestamp with time zone;
--> statement-breakpoint
-- STORED generated full-text vector — the exact expression every retrieval query
-- uses inline, so search_vector @@ q / ts_rank(search_vector, q) are equivalent
-- to the previous inline to_tsvector(...) form. title/content are NOT NULL so the
-- concatenation never yields NULL.
ALTER TABLE ai_live_documents
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || content)) STORED;
--> statement-breakpoint
-- Title unique so the staging push + citable boot sync can upsert on title.
CREATE UNIQUE INDEX IF NOT EXISTS ai_live_documents_title_uniq
  ON ai_live_documents (title);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_live_documents_doc_class_idx
  ON ai_live_documents (doc_class);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_live_documents_home_root_idx
  ON ai_live_documents (home_root);
--> statement-breakpoint
-- Plain GIN index over the stored generated column (avoids the drizzle-kit
-- expression-GIN codegen bug).
CREATE INDEX IF NOT EXISTS ai_live_documents_search_idx
  ON ai_live_documents USING gin (search_vector);
--> statement-breakpoint
-- Repoint the provenance FK: publishing now writes citable docs to
-- ai_live_documents. Drop the legacy FK first.
ALTER TABLE kb_doc_provenance
  DROP CONSTRAINT IF EXISTS kb_doc_provenance_doc_id_knowledgebase_docs_id_fk;
--> statement-breakpoint
-- Data-safe repoint: any pre-existing provenance rows point at knowledgebase_docs
-- ids. Remap them to the mirrored ai_live twin by title (the mirror upserts on
-- title), then drop any that still cannot resolve, so the new FK never fails
-- validation. Pre-cutover this table is empty (the staging publish that writes
-- provenance is new here), so this is a no-op today and a safety net for replays.
UPDATE kb_doc_provenance p
SET doc_id = al.id
FROM knowledgebase_docs k
JOIN ai_live_documents al ON al.title = k.title
WHERE p.doc_id = k.id
  AND NOT EXISTS (SELECT 1 FROM ai_live_documents a2 WHERE a2.id = p.doc_id);
--> statement-breakpoint
DELETE FROM kb_doc_provenance p
WHERE NOT EXISTS (SELECT 1 FROM ai_live_documents a WHERE a.id = p.doc_id);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE kb_doc_provenance
    ADD CONSTRAINT kb_doc_provenance_doc_id_ai_live_documents_id_fk
    FOREIGN KEY (doc_id) REFERENCES ai_live_documents(id)
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
