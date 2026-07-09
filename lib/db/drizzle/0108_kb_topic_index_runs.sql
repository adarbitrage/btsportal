-- Topic-index run reports + per-source classification state (Task #1794).
-- Durable observability for the "Build Topic Index" pipeline: run progress /
-- outcome splits / failure reasons survive restarts, and the per-source outcome
-- distinguishes a deliberate LLM "no nodes fit" verdict from a degraded
-- lexical fallback so force=false re-runs can self-heal.

CREATE TABLE IF NOT EXISTS kb_topic_index_runs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  force BOOLEAN NOT NULL DEFAULT FALSE,
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  llm_count INTEGER NOT NULL DEFAULT 0,
  llm_none_count INTEGER NOT NULL DEFAULT 0,
  lexical_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  linked_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  failures JSONB NOT NULL DEFAULT '[]'::jsonb,
  duplicate_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  quality_check JSONB DEFAULT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_topic_index_runs_started_idx
  ON kb_topic_index_runs(started_at);

CREATE TABLE IF NOT EXISTS kb_topic_index_source_state (
  source_doc_id INTEGER PRIMARY KEY REFERENCES ai_source_documents(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL,
  error TEXT,
  run_id INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_topic_index_source_state_outcome_idx
  ON kb_topic_index_source_state(outcome);
