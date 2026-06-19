-- Blitz progress-tracking tables (phases, raw events, daily activity rollup).
--
-- These three tables were added directly to lib/db/src/schema/blitz-events.ts
-- and only ever reached databases through `drizzle-kit push` (the schema is the
-- deployment source of truth). They had no companion .sql migration, so a DB
-- built from `lib/db/drizzle/*.sql` alone was missing them and they showed up
-- as `onlyInPush` drift in lib/db/src/migration-drift.test.ts. This file is the
-- idempotent companion that keeps the migration history in parity with the
-- schema — a harmless no-op on a DB that already has the tables (created via
-- push), and the canonical CREATE for a fresh migrate-only database.

CREATE TABLE IF NOT EXISTS "blitz_phases" (
  "slug" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "sort_order" integer NOT NULL,
  "color" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "blitz_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "course_id" text NOT NULL,
  "event_type" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "video_position_seconds" integer,
  "scroll_position_pct" real
);

CREATE INDEX IF NOT EXISTS "blitz_events_user_occurred_idx"
  ON "blitz_events" ("user_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "blitz_events_user_course_idx"
  ON "blitz_events" ("user_id", "course_id", "occurred_at");

CREATE TABLE IF NOT EXISTS "blitz_daily_activity" (
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "activity_date" date NOT NULL,
  "event_count" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "blitz_daily_activity_user_id_activity_date_pk" PRIMARY KEY ("user_id", "activity_date")
);
