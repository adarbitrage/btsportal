-- Billing hardening (Task #1572): DB-backed heartbeat for billing background
-- jobs. Deliberately in Postgres, not Redis, so the renewal-charger
-- dead-man's-switch and the daily digest survive a full Redis outage.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + guarded ADD CONSTRAINT, so applying
-- it on an already-migrated database (or a fresh one) is a safe no-op.
CREATE TABLE IF NOT EXISTS billing_ops_heartbeat (
  id serial PRIMARY KEY,
  name text NOT NULL,
  last_run_at timestamptz NOT NULL DEFAULT now(),
  run_count integer NOT NULL DEFAULT 0,
  recent_runs jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE billing_ops_heartbeat
    ADD CONSTRAINT billing_ops_heartbeat_name_unique UNIQUE (name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

-- Additive column for databases created before recent_runs existed. Idempotent:
-- ADD COLUMN IF NOT EXISTS is a no-op once the column is present.
ALTER TABLE billing_ops_heartbeat
  ADD COLUMN IF NOT EXISTS recent_runs jsonb NOT NULL DEFAULT '[]'::jsonb;
