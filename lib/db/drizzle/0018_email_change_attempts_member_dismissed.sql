-- Adds the `dismissed_by_member_at` column to `email_change_attempts` so the
-- portal can remember when a member dismissed the in-app banner that explains
-- a previously pending email change was cancelled by an admin. Without this
-- column the banner re-renders on every page load (the cancellation timestamp
-- alone never moves) which is annoying for members who already saw it.
--
-- The new column is nullable: only rows whose banner the member explicitly
-- dismissed are stamped, and only when `cancelled_by_admin_id IS NOT NULL`
-- (set by POST /members/me/email/admin-cancellation/dismiss). All existing
-- rows stay null which is exactly the "not yet dismissed" state.
--
-- Idempotent so it is safe to re-run against a database that already has
-- the column from `drizzle-kit push`.
ALTER TABLE "email_change_attempts"
    ADD COLUMN IF NOT EXISTS "dismissed_by_member_at" timestamp with time zone;
