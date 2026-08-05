-- FE-Intensive booking store of record (Welcome page native booking surface).
-- Idempotent so re-running is a no-op.

CREATE TABLE IF NOT EXISTS "fe_intensive_bookings" (
  "id"                 serial PRIMARY KEY NOT NULL,
  "member_id"          integer NOT NULL,
  "ghl_calendar_id"    text NOT NULL,
  "ghl_location_id"    text,
  "ghl_appointment_id" text,
  "ghl_contact_id"     text,
  "scheduled_at"       timestamp with time zone NOT NULL,
  "end_at"             timestamp with time zone NOT NULL,
  "duration_minutes"   integer DEFAULT 60 NOT NULL,
  "status"             text DEFAULT 'booked' NOT NULL,
  "created_at"         timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"         timestamp with time zone DEFAULT now() NOT NULL,
  "cancelled_at"       timestamp with time zone
);

DO $$ BEGIN
  ALTER TABLE "fe_intensive_bookings"
    ADD CONSTRAINT "fe_intensive_bookings_member_id_users_id_fk"
    FOREIGN KEY ("member_id") REFERENCES "users"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "fe_intensive_bookings"
    ADD CONSTRAINT "fe_intensive_bookings_ghl_appointment_id_unique"
    UNIQUE ("ghl_appointment_id");
EXCEPTION
  -- Re-adding a UNIQUE constraint raises duplicate_table (its backing index
  -- already exists), not duplicate_object — catch both for idempotency.
  WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_fe_intensive_bookings_member"
  ON "fe_intensive_bookings" ("member_id", "scheduled_at");
