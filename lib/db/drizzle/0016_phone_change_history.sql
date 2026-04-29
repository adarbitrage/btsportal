-- Per-user history of prior phone numbers, written when a member updates the
-- phone number on their profile. Used by the admin global search so support
-- staff can still locate a member by the phone number they had on file at the
-- time, mirroring how `email_change_history` is used for old email addresses.
-- Idempotent so it is safe to re-run against a database that already has the
-- table from `drizzle-kit push`.
CREATE TABLE IF NOT EXISTS "phone_change_history" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "old_phone" text NOT NULL,
        "new_phone" text,
        "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "phone_change_history"
        ADD CONSTRAINT "phone_change_history_user_id_users_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phone_change_history_old_phone_idx"
    ON "phone_change_history" ("old_phone");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phone_change_history_user_id_idx"
    ON "phone_change_history" ("user_id");
