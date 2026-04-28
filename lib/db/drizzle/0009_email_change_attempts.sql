-- Per-user audit log used to rate-limit POST /members/me/email
-- (3 requests/hour, 10 requests/day). One row is inserted for every
-- accepted email-change request inside the same transaction that
-- updates the user record, guarded by a Postgres advisory lock so
-- concurrent requests from the same account cannot bypass the cap.
-- Idempotent so it is safe to re-run against a database that already
-- has the table from `drizzle-kit push`.
CREATE TABLE IF NOT EXISTS "email_change_attempts" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "email_change_attempts"
        ADD CONSTRAINT "email_change_attempts_user_id_users_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_change_attempts_user_created_idx"
    ON "email_change_attempts" ("user_id", "created_at");
