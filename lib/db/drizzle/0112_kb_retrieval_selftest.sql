-- Task #1804: retrieval-aligned "Analyze with AI".
-- Additive, idempotent (fresh envs seed via these; the drift-gated post-merge
-- push covers prod). Draft embeddings are NEVER stored — only the self-test
-- RESULT JSON lands here.

ALTER TABLE kb_staging_docs ADD COLUMN IF NOT EXISTS retrieval_self_test jsonb;

CREATE TABLE IF NOT EXISTS "kb_proposed_synonyms" (
  "id" serial PRIMARY KEY,
  "member_phrase" text NOT NULL UNIQUE,
  "canonical_term" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "occurrence_count" integer NOT NULL DEFAULT 1,
  "example_context" text,
  "reviewed_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp with time zone,
  "first_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "kb_proposed_synonyms_status_idx" ON "kb_proposed_synonyms" ("status");
