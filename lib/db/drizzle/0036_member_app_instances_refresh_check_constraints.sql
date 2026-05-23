-- Refresh the stale CHECK constraints on `member_app_instances` and
-- `app_global_settings` so they include the values that have since been
-- added to `APP_NAMES` (`'flexy'`) and `APP_STATUSES` (`'uninstalling'`)
-- in `lib/db/src/schema/member-app-instances.ts`.
--
-- The original constraints were created inline in
-- 0004_squidy_member_app_instances.sql and 0005_app_global_settings.sql
-- with allowlists that pre-date the Flexy app rollout and the
-- "uninstalling" status. Production environments running every
-- migration still have those stale allowlists, which would reject any
-- insert of a Flexy row or an "uninstalling" status — while dev / test
-- environments provisioned via `drizzle-kit push` never had any CHECK
-- at all because the schema didn't mirror them.
--
-- Drop and re-add with the current allowlists so both code paths
-- produce the same constraint set. Matches the `check(...)` clauses
-- now declared in the schema files.
--
-- Idempotent so it is safe to re-run against a database that already
-- has the refreshed constraints from `drizzle-kit push`.

ALTER TABLE "member_app_instances"
  DROP CONSTRAINT IF EXISTS "member_app_instances_app_name_check";
--> statement-breakpoint
ALTER TABLE "member_app_instances"
  ADD CONSTRAINT "member_app_instances_app_name_check"
  CHECK ("app_name" IN ('diytrax','pixelpress','gifster','metricmover','noescape','flexy'));
--> statement-breakpoint
ALTER TABLE "member_app_instances"
  DROP CONSTRAINT IF EXISTS "member_app_instances_status_check";
--> statement-breakpoint
ALTER TABLE "member_app_instances"
  ADD CONSTRAINT "member_app_instances_status_check"
  CHECK ("status" IN ('not_installed','installing','installed','install_failed','uninstalling'));
--> statement-breakpoint
ALTER TABLE "app_global_settings"
  DROP CONSTRAINT IF EXISTS "app_global_settings_app_name_check";
--> statement-breakpoint
ALTER TABLE "app_global_settings"
  ADD CONSTRAINT "app_global_settings_app_name_check"
  CHECK ("app_name" IN ('diytrax','pixelpress','gifster','metricmover','noescape','flexy'));
