-- Phase-1 scaffold: new, empty, additive AI Knowledgebase corpus table.
-- Cleanly separated from the legacy `knowledgebase_docs` table. Idempotent so it
-- is safe to (re-)run via post-merge push and on existing environments.
CREATE TABLE IF NOT EXISTS ai_live_documents (
  id serial PRIMARY KEY,
  title text NOT NULL,
  slug text,
  category text NOT NULL DEFAULT 'faq',
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- GIN full-text expression index removed: drizzle-kit ^0.31.9 generates a
-- malformed `tsvector_ops` operator class outside the expression, which Postgres
-- rejects. The table is empty/unused in phase 1 so the index provided no value.
-- Re-add as a stored generated tsvector column + plain GIN index in phase 2.
DROP INDEX IF EXISTS ai_live_documents_search_idx;

CREATE UNIQUE INDEX IF NOT EXISTS ai_live_documents_slug_uniq
  ON ai_live_documents (slug);
