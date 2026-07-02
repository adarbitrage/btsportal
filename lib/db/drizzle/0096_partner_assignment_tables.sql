-- Accountability Partner system (Task #1577): partner roster, member<->partner
-- assignment history, and the kickoff-coach roster. All three tables are new
-- and additive, so this is a pure CREATE — no data migration needed.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + guarded ADD CONSTRAINT / CREATE
-- INDEX IF NOT EXISTS, so applying it on an already-migrated database (or a
-- fresh one) is a safe no-op.

CREATE TABLE IF NOT EXISTS partners (
  id serial PRIMARY KEY,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  photo_url text,
  bio text,
  is_active boolean NOT NULL DEFAULT true,
  max_daily_calls integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE partners ADD CONSTRAINT partners_user_id_unique UNIQUE (user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS partner_assignments (
  id serial PRIMARY KEY,
  member_id integer NOT NULL REFERENCES users(id),
  partner_id integer NOT NULL REFERENCES partners(id),
  status text NOT NULL DEFAULT 'active',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One ACTIVE assignment per member. This is the invariant that makes
-- round-robin assignment idempotent and reassignment safe (the old row must
-- be ended in the same transaction that inserts the new one).
CREATE UNIQUE INDEX IF NOT EXISTS partner_assignments_member_active_uidx
  ON partner_assignments (member_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS kickoff_coaches (
  id serial PRIMARY KEY,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  photo_url text,
  bio text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE kickoff_coaches ADD CONSTRAINT kickoff_coaches_user_id_unique UNIQUE (user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;
