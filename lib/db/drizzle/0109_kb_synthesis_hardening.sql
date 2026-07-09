-- Synthesis Engine hardening (mirrors the topic-index hardening in 0108).
-- 1) kb_source_node_extracts gains an honest per-(source,node) outcome: a
--    failed LLM extraction is recorded durably (status='failed') but is NEVER
--    a cache hit, so the next run retries it — the old silent raw-window
--    fallback that got cached as a success is gone.
-- 2) kb_node_synthesis_state gains last_error/last_attempt_at so failed node
--    syntheses are visible and incremental reruns self-heal them.
-- 3) kb_synthesis_runs: durable run reports (per-node outcomes + failures).
-- Idempotent (ADD COLUMN / CREATE TABLE / INDEX IF NOT EXISTS).

ALTER TABLE kb_source_node_extracts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS error TEXT;

ALTER TABLE kb_node_synthesis_state
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS kb_synthesis_runs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  scope TEXT NOT NULL DEFAULT 'nodes',
  total_nodes INTEGER NOT NULL DEFAULT 0,
  processed_nodes INTEGER NOT NULL DEFAULT 0,
  created_drafts INTEGER NOT NULL DEFAULT 0,
  succeeded_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  failures JSONB NOT NULL DEFAULT '[]'::jsonb,
  node_outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_synthesis_runs_started_idx
  ON kb_synthesis_runs(started_at);
