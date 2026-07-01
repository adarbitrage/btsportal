-- Synthesis Engine Part 3 (Task #1535): Live AI Document version history.
-- Snapshots the prior published content of a Live AI Document BEFORE an approved
-- revision supersedes it, preserving version + provenance history.
-- New, additive table. Idempotent (CREATE TABLE/INDEX IF NOT EXISTS). Constraint
-- names match drizzle-kit's generated names so the schema-vs-migration drift test
-- sees no divergence.
CREATE TABLE IF NOT EXISTS ai_live_document_versions (
  id serial PRIMARY KEY,
  doc_id integer NOT NULL,
  version_number integer NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  doc_class text,
  home_root text,
  node text,
  last_verified timestamptz,
  provenance jsonb,
  superseded_by_staging_doc_id integer,
  superseded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_live_document_versions_doc_id_ai_live_documents_id_fk
    FOREIGN KEY (doc_id) REFERENCES ai_live_documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ai_live_doc_versions_doc_idx ON ai_live_document_versions (doc_id);
