-- Squidy member app instances.
-- Strategy: rows are lazily created when a member first installs an app
-- (POST /apps/:appName/install). Apps the member has never touched simply
-- have no row and are surfaced as "not_installed" by the API. The
-- (user_id, app_name) UNIQUE constraint guarantees one row per member/app.
CREATE TABLE "member_app_instances" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "app_name" text NOT NULL,
        "status" text DEFAULT 'not_installed' NOT NULL,
        "domain" text,
        "app_uuid" text,
        "squidy_status" text,
        "squidy_sub_status" text,
        "last_lookup_at" timestamp with time zone,
        "squidy_error" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "member_app_instances_user_app_unique" UNIQUE("user_id","app_name"),
        CONSTRAINT "member_app_instances_app_name_check" CHECK ("app_name" IN ('diytrax','pixelpress','gifster','metricmover','noescape')),
        CONSTRAINT "member_app_instances_status_check" CHECK ("status" IN ('not_installed','installing','installed','install_failed'))
);
--> statement-breakpoint
ALTER TABLE "member_app_instances" ADD CONSTRAINT "member_app_instances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_app_instances_user_id_idx" ON "member_app_instances" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_app_instances_status_idx" ON "member_app_instances" USING btree ("status");
