-- AI Source Knowledge library — the raw-source layer behind the assistant.
-- New, empty, additive table. Cleanly separated from both the legacy
-- `knowledgebase_docs` retrieval corpus and the curated `ai_live_documents`
-- corpus. Idempotent so it is safe to (re-)run via post-merge push and on
-- existing environments. Ships empty — content arrives via a later gated import.
CREATE TABLE IF NOT EXISTS ai_source_documents (
  id serial PRIMARY KEY,
  title text NOT NULL,
  content text NOT NULL,
  source_type text NOT NULL,
  authority_role text NOT NULL DEFAULT 'internal',
  source_name text,
  source_id integer,
  provenance_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_source_documents_source_type_idx
  ON ai_source_documents (source_type);
CREATE INDEX IF NOT EXISTS ai_source_documents_authority_role_idx
  ON ai_source_documents (authority_role);
