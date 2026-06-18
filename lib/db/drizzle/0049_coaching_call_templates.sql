-- Recurring coaching-call schedule templates.
--
-- A template ("every Monday 2pm, coach X, weekly_qa") lets admins set up a
-- repeating call in one step: the system generates the next N weeks of ordinary
-- `coaching_calls` rows from it. Generated calls are plain `coaching_calls`
-- rows linked back via `template_id`, so editing or cancelling one occurrence
-- never disturbs the rest of the series, and they flow through the member-facing
-- schedule unchanged.
--
-- Idempotent companion to the drizzle schema (kept in parity for the drift
-- tests). Harmless no-op on a DB that already has the table / column.

CREATE TABLE IF NOT EXISTS "coaching_call_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "call_type" text DEFAULT 'weekly_qa' NOT NULL,
  "coach_id" integer NOT NULL REFERENCES "coaches"("id"),
  "meet_link" text,
  "duration_minutes" integer DEFAULT 60 NOT NULL,
  "required_entitlement" text DEFAULT 'coaching:group' NOT NULL,
  "interval_days" integer DEFAULT 7 NOT NULL,
  "occurrences_per_batch" integer DEFAULT 8 NOT NULL,
  "anchor_at" timestamp with time zone NOT NULL,
  "last_generated_at" timestamp with time zone,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "coaching_calls"
  ADD COLUMN IF NOT EXISTS "template_id" integer;

DO $$ BEGIN
  ALTER TABLE "coaching_calls"
    ADD CONSTRAINT "coaching_calls_template_id_coaching_call_templates_id_fk"
    FOREIGN KEY ("template_id") REFERENCES "coaching_call_templates"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A UNIQUE constraint creates a backing index of the same name, so a re-run can
-- trip either duplicate_object (constraint exists) or duplicate_table (the
-- index/relation already exists); swallow both to stay idempotent.
DO $$ BEGIN
  ALTER TABLE "coaching_calls"
    ADD CONSTRAINT "coaching_calls_template_slot_unq" UNIQUE ("template_id", "scheduled_at");
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;
