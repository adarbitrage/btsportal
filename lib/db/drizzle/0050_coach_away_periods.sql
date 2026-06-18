-- 0050_coach_away_periods.sql
-- Task: let coaches (or admins on their behalf) mark date ranges as "away".
--
-- Adds the `coach_away_periods` table. While today falls inside an away period
-- the coach is hidden from the member "Your Coaches" grid and is not bookable
-- for private coaching, then auto-restored once the period passes. Mirrors
-- lib/db/src/schema/coach-away-periods.ts.
--
-- Applied explicitly here (and via sync-dev-db.sh for dev/tests) so the
-- live-schema-drift gate in post-merge sees the table already present and skips
-- the full `drizzle-kit push --force`. Idempotent: CREATE ... IF NOT EXISTS, so
-- it replays cleanly on dev, prod, and the migration-drift migrateDb.

CREATE TABLE IF NOT EXISTS coach_away_periods (
  id serial PRIMARY KEY,
  coach_id integer NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coach_away_periods_coach
  ON coach_away_periods (coach_id);
