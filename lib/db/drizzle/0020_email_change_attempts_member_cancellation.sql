-- Adds the `cancelled_by_member` boolean to `email_change_attempts` so the
-- attempts list can distinguish admin-initiated cancellations from
-- member-initiated cancel/replace flows. Set together with `cancelled_at`
-- by POST /members/me/email/cancel and the replace branch of
-- POST /members/me/email; `cancelled_by_admin_id` continues to mark the
-- admin path. Defaults to false so existing rows (none of which were stamped
-- by the member path before this change) classify correctly as the legacy
-- "cancelled_by_admin" or simply un-cancelled cohort.
--
-- Idempotent so it is safe to re-run against a database that already has
-- the column from `drizzle-kit push`.
ALTER TABLE "email_change_attempts"
    ADD COLUMN IF NOT EXISTS "cancelled_by_member" boolean NOT NULL DEFAULT false;
