-- KB review flag lifecycle (Task #1906).
-- 1. kb_highlight_dismissals: passage-level "Ignore" for review-insight
--    highlights, keyed on (kind + normalized excerpt) so a dismissal survives
--    re-synthesis of the identical passage in a fresh draft.
-- 2. kb_flag_resolutions: doc-level Resolve/Ignore for stored risk flags, one
--    per (doc, flag type); the fingerprint pins the resolution to the flag's
--    trigger so deterministic re-triage never resurrects a resolved flag
--    unless the trigger is new.
-- Written idempotently so re-running is a harmless no-op.

CREATE TABLE IF NOT EXISTS "kb_highlight_dismissals" (
  "id"              serial PRIMARY KEY NOT NULL,
  "kind"            text NOT NULL,
  "excerpt_norm"    text NOT NULL,
  "display_excerpt" text NOT NULL,
  "staging_doc_id"  integer,
  "dismissed_by"    integer,
  "reason"          text,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "kb_highlight_dismissals_kind_excerpt_unique" UNIQUE("kind","excerpt_norm")
);

DO $$ BEGIN
  ALTER TABLE "kb_highlight_dismissals"
    ADD CONSTRAINT "kb_highlight_dismissals_staging_doc_id_kb_staging_docs_id_fk"
    FOREIGN KEY ("staging_doc_id") REFERENCES "kb_staging_docs"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "kb_highlight_dismissals"
    ADD CONSTRAINT "kb_highlight_dismissals_dismissed_by_users_id_fk"
    FOREIGN KEY ("dismissed_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "kb_flag_resolutions" (
  "id"             serial PRIMARY KEY NOT NULL,
  "staging_doc_id" integer NOT NULL,
  "flag_type"      text NOT NULL,
  "fingerprint"    text NOT NULL,
  "resolved_by"    integer,
  "reason"         text,
  "created_at"     timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "kb_flag_resolutions_doc_type_unique" UNIQUE("staging_doc_id","flag_type")
);

DO $$ BEGIN
  ALTER TABLE "kb_flag_resolutions"
    ADD CONSTRAINT "kb_flag_resolutions_staging_doc_id_kb_staging_docs_id_fk"
    FOREIGN KEY ("staging_doc_id") REFERENCES "kb_staging_docs"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "kb_flag_resolutions"
    ADD CONSTRAINT "kb_flag_resolutions_resolved_by_users_id_fk"
    FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
