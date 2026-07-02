-- Tier 2 of the Guided Onboarding + Accountability Partner build (Task #1591):
-- native kickoff + partner call booking. Adds the single store-of-record
-- `call_bookings` table plus the GHL-calendar columns partners/kickoff_coaches
-- need to be bookable, and a nullable cadence column on partner_assignments
-- that later tasks (T4/T6) populate/display.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS + guarded ADD COLUMN, so
-- applying it on an already-migrated database (or a fresh one) is a safe
-- no-op.

CREATE TABLE IF NOT EXISTS call_bookings (
  id serial PRIMARY KEY,
  member_id integer NOT NULL REFERENCES users(id),
  staff_type text NOT NULL,
  staff_id integer NOT NULL,
  type text NOT NULL,
  ghl_calendar_id text NOT NULL,
  ghl_location_id text,
  ghl_appointment_id text,
  ghl_contact_id text,
  scheduled_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  meeting_url text,
  status text NOT NULL DEFAULT 'booked',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);

DO $$ BEGIN
  ALTER TABLE call_bookings ADD CONSTRAINT call_bookings_ghl_appointment_id_unique UNIQUE (ghl_appointment_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_call_bookings_member ON call_bookings (member_id);
CREATE INDEX IF NOT EXISTS idx_call_bookings_staff_scheduled ON call_bookings (staff_id, scheduled_at);

ALTER TABLE partners ADD COLUMN IF NOT EXISTS ghl_calendar_id text;
ALTER TABLE kickoff_coaches ADD COLUMN IF NOT EXISTS ghl_calendar_id text;
ALTER TABLE partner_assignments ADD COLUMN IF NOT EXISTS cadence_per_week integer;
