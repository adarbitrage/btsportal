-- Global per-app enable/disable settings for the 5 Squidy apps.
-- Admins can disable an app globally; all member-facing actions for that app
-- will return 403 until re-enabled. Existing installs are preserved intact.
-- Rows are seeded on first access (all apps default to enabled = true).
CREATE TABLE "app_global_settings" (
        "app_name" text PRIMARY KEY NOT NULL,
        "enabled" boolean DEFAULT true NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_by_id" integer,
        "updated_by_email" text,
        CONSTRAINT "app_global_settings_app_name_check" CHECK ("app_name" IN ('diytrax','pixelpress','gifster','metricmover','noescape'))
);
--> statement-breakpoint
ALTER TABLE "app_global_settings" ADD CONSTRAINT "app_global_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Seed all 5 apps as enabled. Idempotent: safe to run on existing tables.
INSERT INTO "app_global_settings" ("app_name", "enabled", "updated_at")
VALUES
  ('diytrax',     true, now()),
  ('pixelpress',  true, now()),
  ('gifster',     true, now()),
  ('metricmover', true, now()),
  ('noescape',    true, now())
ON CONFLICT ("app_name") DO NOTHING;
