-- Content-Gap Radar: one row per distinct unanswered/low-confidence question the
-- AI assistants (chat or voice) could not confidently answer. Repeats group by
-- (surface, normalized_question). Written idempotently so re-running against an
-- already-migrated database is a no-op.

CREATE TABLE IF NOT EXISTS "content_gap_questions" (
  "id"                 serial PRIMARY KEY NOT NULL,
  "surface"            text NOT NULL,
  "normalized_question" text NOT NULL,
  "question_text"      text NOT NULL,
  "top_score"          real NOT NULL DEFAULT 0,
  "near_misses"        jsonb NOT NULL DEFAULT '[]',
  "ask_count"          integer NOT NULL DEFAULT 1,
  "first_asked_at"     timestamp with time zone DEFAULT now() NOT NULL,
  "last_asked_at"      timestamp with time zone DEFAULT now() NOT NULL,
  "created_at"         timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"         timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_gap_questions_surface_question_unique" UNIQUE("surface", "normalized_question")
);

CREATE INDEX IF NOT EXISTS "content_gap_questions_ask_count_idx"
  ON "content_gap_questions" USING btree ("ask_count");

CREATE INDEX IF NOT EXISTS "content_gap_questions_last_asked_idx"
  ON "content_gap_questions" USING btree ("last_asked_at");
