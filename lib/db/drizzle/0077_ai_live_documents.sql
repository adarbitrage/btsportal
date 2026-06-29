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

CREATE INDEX IF NOT EXISTS ai_live_documents_search_idx
  ON ai_live_documents USING gin (to_tsvector('english', title || ' ' || content));

CREATE UNIQUE INDEX IF NOT EXISTS ai_live_documents_slug_uniq
  ON ai_live_documents (slug);
