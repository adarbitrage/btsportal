-- Topic index — source→taxonomy-node relevance layer (Task #1533, Synthesis Engine).
-- New, additive many-to-many link table between ai_source_documents and taxonomy
-- nodes. Persists an LLM/lexical classification pass so synthesis can gather all
-- material for a node across the whole corpus (no pgvector in the repo).
-- Applying it explicitly here keeps the live-schema-drift gate green so the
-- conditional push stays skipped on the common merge. Idempotent
-- (CREATE TABLE/INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS kb_source_node_links (
  id serial PRIMARY KEY,
  source_doc_id integer NOT NULL REFERENCES ai_source_documents(id) ON DELETE CASCADE,
  home_root text NOT NULL,
  node text NOT NULL,
  relevance real NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'llm',
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_source_node_links_node_idx
  ON kb_source_node_links(node);
CREATE INDEX IF NOT EXISTS kb_source_node_links_source_idx
  ON kb_source_node_links(source_doc_id);
CREATE UNIQUE INDEX IF NOT EXISTS kb_source_node_links_source_node_unq
  ON kb_source_node_links(source_doc_id, node);
