-- Synthesis Engine Part 2 (Task #1534): durable per-node synthesis state.
-- Records when each taxonomy node was last synthesized and from which source
-- documents, so incremental runs can re-synthesize only nodes whose linked
-- source set changed. New, additive table. Idempotent (CREATE ... IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS kb_node_synthesis_state (
  id serial PRIMARY KEY,
  node text NOT NULL,
  home_root text NOT NULL,
  last_synthesized_at timestamptz NOT NULL DEFAULT now(),
  source_doc_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_count integer NOT NULL DEFAULT 0,
  last_draft_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_node_synthesis_state_node_uniq
  ON kb_node_synthesis_state (node);
CREATE INDEX IF NOT EXISTS kb_node_synthesis_state_home_root_idx
  ON kb_node_synthesis_state (home_root);
