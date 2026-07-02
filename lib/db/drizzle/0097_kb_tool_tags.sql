-- Task #1586: admin-manageable TOOL-tag vocabulary + AI-proposes queue.
-- Idempotent (CREATE TABLE IF NOT EXISTS) so it is safe to run repeatedly in
-- post-merge and on boot.

CREATE TABLE IF NOT EXISTS kb_tool_tags (
  id serial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  triggers jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  protected boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'seed',
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_tool_tags_enabled_idx ON kb_tool_tags (enabled);

CREATE TABLE IF NOT EXISTS kb_proposed_tool_tags (
  id serial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  suggested_triggers jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  occurrence_count integer NOT NULL DEFAULT 1,
  example_context text,
  reviewed_by integer REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp with time zone,
  first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_proposed_tool_tags_status_idx ON kb_proposed_tool_tags (status);
