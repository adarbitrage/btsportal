-- Synthesis Engine full-source read (Task #1561): per-source, per-node MAP-phase
-- extract cache. The map phase now reads the WHOLE of every source (no 6k
-- truncation) and the reduce phase folds in ALL linked sources (no top-12 cap),
-- so extraction is expensive; this cache lets incremental re-runs reuse the
-- finished extract for any source whose content didn't change. Content-addressed
-- invalidation: a hit requires (source_doc_id, node) AND a content_fingerprint
-- match. New, additive table. Idempotent (CREATE ... IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS kb_source_node_extracts (
  id serial PRIMARY KEY,
  source_doc_id integer NOT NULL REFERENCES ai_source_documents(id) ON DELETE CASCADE,
  node text NOT NULL,
  content_fingerprint text NOT NULL,
  extract text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_source_node_extracts_node_idx
  ON kb_source_node_extracts (node);
CREATE UNIQUE INDEX IF NOT EXISTS kb_source_node_extracts_source_node_unq
  ON kb_source_node_extracts (source_doc_id, node);
