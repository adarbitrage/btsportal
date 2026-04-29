-- Records lightweight analytics events for the "What you'd unlock" upgrade
-- prompt widgets shown to non-lifetime members on the dashboard and in the
-- sidebar. Lets the team A/B test copy and prioritize features by tracking
-- which variants and locked feature combinations actually drive clicks.
--
-- Idempotent so it is safe to re-run against a database that already has the
-- table (e.g. created via `drizzle-kit push`).

CREATE TABLE IF NOT EXISTS "upgrade_prompt_events" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" integer,
    "event_type" text NOT NULL,
    "variant" text NOT NULL,
    "source_tier" text NOT NULL,
    "locked_feature_keys" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "metadata" jsonb,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'upgrade_prompt_events'
          AND constraint_name = 'upgrade_prompt_events_user_id_users_id_fk'
    ) THEN
        ALTER TABLE "upgrade_prompt_events"
            ADD CONSTRAINT "upgrade_prompt_events_user_id_users_id_fk"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_upgrade_prompt_events_user_time"
    ON "upgrade_prompt_events" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_upgrade_prompt_events_variant_type_time"
    ON "upgrade_prompt_events" ("variant", "event_type", "created_at");
