-- Adds the `cancelled_at` and `cancelled_by_admin_id` columns to
-- `email_change_attempts` so the admin Member Detail page can distinguish
-- attempts that an admin explicitly cancelled (via
-- POST /admin/members/:id/cancel-email-change) from attempts that simply
-- expired or were abandoned by the member. The cancel handler updates the
-- still-pending row in the same transaction it clears the user's pending
-- email so the audit trail is preserved long after the user-side state is
-- reset.
--
-- Both columns are nullable: existing rows have no cancellation info, and
-- the vast majority of new rows never get cancelled by an admin either.
-- The FK uses ON DELETE SET NULL so deleting an admin user (rare) does not
-- cascade-delete real member email-change history.
--
-- Idempotent so it is safe to re-run against a database that already has
-- the columns from `drizzle-kit push`.
ALTER TABLE "email_change_attempts"
    ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "email_change_attempts"
    ADD COLUMN IF NOT EXISTS "cancelled_by_admin_id" integer
        REFERENCES "users"("id") ON DELETE SET NULL;
