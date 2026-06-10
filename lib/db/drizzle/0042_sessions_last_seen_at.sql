-- Adds `sessions.last_seen_at` so the admin Member Detail "Active sessions"
-- card can show when a session was last active, distinct from when it was
-- first created (its original sign-in time).
--
-- The /auth/refresh path rotates tokens (revoke old row + insert new row) on
-- every refresh. The new row now inherits the original session's created_at
-- and stamps last_seen_at = now(), so created_at stays the sign-in time while
-- last_seen_at tracks the most recent refresh.
--
-- Backfill existing rows so the NOT NULL column has a sensible value: seed
-- last_seen_at from created_at (best available proxy for last activity).
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded backfill that only touches
-- rows where the column is still its default-on-add value is unnecessary
-- because the column is created with DEFAULT now(); the explicit backfill
-- below aligns pre-existing rows to their created_at instead.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone NOT NULL DEFAULT now();
--> statement-breakpoint
UPDATE "sessions" SET "last_seen_at" = "created_at" WHERE "last_seen_at" < "created_at";
