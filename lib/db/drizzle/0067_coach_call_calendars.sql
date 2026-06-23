-- Per-(coach, callType) booking calendar config.
--
-- A single coach can offer more than one bookable kind of call, each with its
-- own GoHighLevel booking calendar — which the handful of ghl* columns on the
-- coach row can't model. This table is the single source of truth for those
-- calendars. Pure additive table; idempotent (CREATE TABLE / guarded DO blocks)
-- so it replays cleanly on top of a database drizzle-kit push already created.
CREATE TABLE IF NOT EXISTS coach_call_calendars (
  id serial PRIMARY KEY,
  coach_id integer NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  call_type text NOT NULL,
  booking_calendar_id text,
  booking_location_id text,
  conflict_calendar_id text,
  conflict_location_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One calendar config per (coach, callType).
DO $$ BEGIN
  ALTER TABLE coach_call_calendars
    ADD CONSTRAINT coach_call_calendars_coach_call_type_unq UNIQUE (coach_id, call_type);
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN duplicate_table  THEN NULL;
END $$;

-- A GHL booking calendar belongs to exactly one (coach, callType). PG treats
-- NULLs as distinct, so unconfigured rows don't collide.
DO $$ BEGIN
  ALTER TABLE coach_call_calendars
    ADD CONSTRAINT coach_call_calendars_booking_calendar_unq UNIQUE (booking_calendar_id);
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN duplicate_table  THEN NULL;
END $$;
