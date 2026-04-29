-- Adds the `new_email` and `expires_at` columns to `email_change_attempts`
-- so the admin member detail page can show every attempt (pending,
-- confirmed, expired, or abandoned) along with what email the member tried
-- to switch to and when the verification link would have expired.
--
-- Both columns are nullable to remain compatible with rows that already
-- exist from before this migration; new inserts done by /members/me/email
-- always populate both. Idempotent so it is safe to re-run against a
-- database that already has the columns from `drizzle-kit push`.
ALTER TABLE "email_change_attempts"
    ADD COLUMN IF NOT EXISTS "new_email" text;
--> statement-breakpoint
ALTER TABLE "email_change_attempts"
    ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
