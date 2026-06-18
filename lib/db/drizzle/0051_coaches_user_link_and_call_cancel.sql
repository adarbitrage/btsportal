-- Companion migration for two additive schema changes that merged without one:
--
--   1. coaches.user_id — optional link from a roster coach to their portal
--      login (usersTable). Nullable, UNIQUE, ON DELETE SET NULL so deleting a
--      user account just unlinks the coach row rather than removing it.
--
--   2. coaching_calls.cancelled_at / cancelled_by — soft-cancel marker for a
--      single occurrence. cancelled_at NULL = active; set = that date is
--      cancelled (the row is KEPT, not deleted, so the slot stays occupied).
--      cancelled_by records who cancelled it (coach or admin), ON DELETE SET
--      NULL so removing the actor's account never deletes the call.
--
-- These columns are declared in lib/db/src/schema/{coaches,coaching-calls}.ts
-- but had no companion .sql, so the migrations-only sync (and any drifted dev
-- DB) fell behind the schema and `drizzle-kit push` would stop on the
-- interactive unique-constraint truncate prompt. This file mirrors exactly the
-- columns + constraints that `drizzle-kit push` produces, keeping both the
-- live-schema-drift and migration-drift tests green.
--
-- Idempotent: guarded ADD COLUMN IF NOT EXISTS + DO blocks that swallow the
-- "already exists" classes, so re-running against an already-synced DB is a
-- harmless no-op.

ALTER TABLE "coaches"
  ADD COLUMN IF NOT EXISTS "user_id" integer;

DO $$ BEGIN
  ALTER TABLE "coaches"
    ADD CONSTRAINT "coaches_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A UNIQUE constraint creates a backing index of the same name, so a re-run can
-- trip either duplicate_object (constraint exists) or duplicate_table (the
-- index/relation already exists); swallow both to stay idempotent.
DO $$ BEGIN
  ALTER TABLE "coaches"
    ADD CONSTRAINT "coaches_user_id_unique" UNIQUE ("user_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

ALTER TABLE "coaching_calls"
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;

ALTER TABLE "coaching_calls"
  ADD COLUMN IF NOT EXISTS "cancelled_by" integer;

DO $$ BEGIN
  ALTER TABLE "coaching_calls"
    ADD CONSTRAINT "coaching_calls_cancelled_by_users_id_fk"
    FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
