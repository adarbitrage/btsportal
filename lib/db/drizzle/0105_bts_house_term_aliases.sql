-- Task #1676: admin-manageable BTS house-term auto-correct overrides.
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS) so it is safe to run
-- repeatedly in post-merge and on boot. Only ADDITIONS live here — the shipped
-- alias baseline stays authoritative in code and is merged at runtime.

CREATE TABLE IF NOT EXISTS bts_house_term_aliases (
  id serial PRIMARY KEY,
  misspelling text NOT NULL UNIQUE,
  canonical text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'admin',
  note text,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bts_house_term_aliases_enabled_idx ON bts_house_term_aliases (enabled);
