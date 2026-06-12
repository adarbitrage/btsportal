-- Standalone, credit-based 1-on-1 session-pack booking feature.
-- Idempotent companion to the drizzle schema (kept in parity for the drift
-- tests). Creates three tables: the GHL-backed coach roster, the bookings
-- that link a member to a GHL appointment, and the append-only credit ledger.

CREATE TABLE IF NOT EXISTS "session_pack_coaches" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "ghl_calendar_id" text NOT NULL,
  "ghl_location_id" text NOT NULL,
  "bio" text,
  "photo_url" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "session_pack_coaches_ghl_calendar_id_unique" UNIQUE ("ghl_calendar_id")
);

CREATE TABLE IF NOT EXISTS "session_pack_bookings" (
  "id" serial PRIMARY KEY,
  "member_id" integer NOT NULL,
  "coach_id" integer NOT NULL,
  "ghl_calendar_id" text NOT NULL,
  "ghl_appointment_id" text,
  "ghl_contact_id" text,
  "scheduled_at" timestamptz NOT NULL,
  "end_at" timestamptz NOT NULL,
  "duration_minutes" integer NOT NULL DEFAULT 30,
  "meet_link" text,
  "status" text NOT NULL DEFAULT 'booked',
  "title" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "cancelled_at" timestamptz,
  CONSTRAINT "session_pack_bookings_ghl_appointment_id_unique" UNIQUE ("ghl_appointment_id"),
  CONSTRAINT "session_pack_bookings_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "users"("id"),
  CONSTRAINT "session_pack_bookings_coach_id_session_pack_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "session_pack_coaches"("id")
);

CREATE TABLE IF NOT EXISTS "coaching_credit_ledger" (
  "id" serial PRIMARY KEY,
  "member_id" integer NOT NULL,
  "delta" integer NOT NULL,
  "reason" text NOT NULL,
  "booking_id" integer,
  "note" text,
  "created_by_user_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "coaching_credit_ledger_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "users"("id"),
  CONSTRAINT "coaching_credit_ledger_booking_id_session_pack_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "session_pack_bookings"("id"),
  CONSTRAINT "coaching_credit_ledger_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "idx_session_pack_booking_member" ON "session_pack_bookings" ("member_id");
CREATE INDEX IF NOT EXISTS "idx_session_pack_booking_scheduled" ON "session_pack_bookings" ("scheduled_at");
CREATE INDEX IF NOT EXISTS "idx_coaching_credit_ledger_member" ON "coaching_credit_ledger" ("member_id");
-- At most one refund credit per booking (defense in depth vs double-refund race).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_coaching_credit_ledger_cancel_refund" ON "coaching_credit_ledger" ("booking_id") WHERE "reason" = 'cancel_refund';
