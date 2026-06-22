-- Member-facing Knowledge Base bookmarks.
--
-- Lets authenticated mentees save KB articles to revisit later. The table was
-- added to lib/db/src/schema/knowledgebase-bookmarks.ts and reaches databases
-- through `drizzle-kit push` (the schema is the deployment source of truth).
-- This idempotent companion keeps the migration history in parity with the
-- schema — a harmless no-op on a DB that already has the table (created via
-- push), and the canonical CREATE for a fresh migrate-only database. It mirrors
-- the constraints Drizzle generates (PK on id, FKs to users/knowledgebase_docs,
-- and a UNIQUE (user_id, doc_id) so a member can bookmark a doc at most once)
-- so lib/db/src/migration-drift.test.ts stays clean.

CREATE TABLE IF NOT EXISTS "knowledgebase_bookmarks" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "doc_id" integer NOT NULL REFERENCES "knowledgebase_docs"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledgebase_bookmarks_user_doc" UNIQUE ("user_id", "doc_id")
);
