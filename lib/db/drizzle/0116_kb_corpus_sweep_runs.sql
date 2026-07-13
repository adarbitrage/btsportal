-- Corpus sweep runs (Task #1903). Durable background-job state for the
-- concept-mode corpus sweep: progress + per-doc verdicts survive restarts and
-- connection timeouts. One new additive table; idempotent.

CREATE TABLE IF NOT EXISTS kb_corpus_sweep_runs (
  id SERIAL PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'concept',
  status TEXT NOT NULL DEFAULT 'running',
  incorrect_concept TEXT NOT NULL,
  correct_concept TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  created_by INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  notes_written_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_corpus_sweep_runs_started_idx
  ON kb_corpus_sweep_runs(started_at);
