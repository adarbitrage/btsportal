-- Task #1776 — Navigation Docs system + synthesis nav-gap flags.
-- Idempotent, additive-only. Safe to re-run.

-- Declared navigation coverage on staging drafts + live docs, plus the
-- authoring screenshot audit trail on staging.
ALTER TABLE kb_staging_docs ADD COLUMN IF NOT EXISTS nav_app text;
ALTER TABLE kb_staging_docs ADD COLUMN IF NOT EXISTS nav_area text;
ALTER TABLE kb_staging_docs ADD COLUMN IF NOT EXISTS nav_screenshots jsonb;

ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS nav_app text;
ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS nav_area text;

-- Durable advisory navigation-gap flags, one row per (app, area).
CREATE TABLE IF NOT EXISTS kb_nav_gap_flags (
  id serial PRIMARY KEY,
  app text NOT NULL,
  area text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'open',
  tier integer NOT NULL DEFAULT 1,
  topic_nodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  topic_count integer NOT NULL DEFAULT 0,
  last_evidence text,
  last_seen_at timestamptz,
  dismissed_at timestamptz,
  dismissed_by integer REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolved_by_doc_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_nav_gap_flags_app_area_uniq ON kb_nav_gap_flags (app, area);
CREATE INDEX IF NOT EXISTS kb_nav_gap_flags_status_idx ON kb_nav_gap_flags (status);
