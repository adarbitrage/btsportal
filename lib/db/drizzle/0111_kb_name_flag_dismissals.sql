-- Reviewer-dismissed "possible member name" pairs (name-flag vocabulary).
-- When a reviewer clicks "Not a name" on a possible_member_name chip, the
-- exact capitalized pair is stored here (lowercased key) and suppressed
-- analyzer-wide. Written idempotently so re-running is a harmless no-op.

CREATE TABLE IF NOT EXISTS "kb_name_flag_dismissals" (
  "id"           serial PRIMARY KEY NOT NULL,
  "pair"         text NOT NULL,
  "display_pair" text NOT NULL,
  "dismissed_by" integer,
  "created_at"   timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "kb_name_flag_dismissals_pair_unique" UNIQUE("pair")
);

DO $$ BEGIN
  ALTER TABLE "kb_name_flag_dismissals"
    ADD CONSTRAINT "kb_name_flag_dismissals_dismissed_by_users_id_fk"
    FOREIGN KEY ("dismissed_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
