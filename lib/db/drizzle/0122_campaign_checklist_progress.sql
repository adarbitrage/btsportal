-- Companion migration for lib/db/src/schema/campaign-checklist-progress.ts
-- Per-member state for the /blitz/campaign-checklist page. Idempotent.
CREATE TABLE IF NOT EXISTS "campaign_checklist_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"network" text,
	"checked_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_checklist_progress" ADD CONSTRAINT "campaign_checklist_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_checklist_progress_user_idx" ON "campaign_checklist_progress" USING btree ("user_id");
