-- Direct messaging tables: dm_threads and dm_messages.
-- dm_threads links a member to an admin; unique on (member_id, admin_id) to
-- prevent duplicate threads.  dm_messages stores individual messages within a
-- thread, with a nullable read_at column to track per-message read state.
--
-- Relevant files:
--   lib/db/src/schema/dm.ts
--   artifacts/api-server/src/middleware/dmPermissions.ts
--   artifacts/api-server/src/storage/dm.ts
--   artifacts/api-server/src/routes/dm.ts

BEGIN;

CREATE TABLE IF NOT EXISTS "dm_threads" (
  "id"              serial PRIMARY KEY NOT NULL,
  "member_id"       integer NOT NULL REFERENCES "users"("id"),
  "admin_id"        integer NOT NULL REFERENCES "users"("id"),
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
  "last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dm_threads_member_admin_unique" UNIQUE ("member_id", "admin_id")
);

CREATE INDEX IF NOT EXISTS "dm_threads_last_message_at_idx"
  ON "dm_threads" ("last_message_at");

CREATE TABLE IF NOT EXISTS "dm_messages" (
  "id"         serial PRIMARY KEY NOT NULL,
  "thread_id"  integer NOT NULL REFERENCES "dm_threads"("id"),
  "sender_id"  integer NOT NULL REFERENCES "users"("id"),
  "body"       text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at"    timestamp with time zone,
  CONSTRAINT "dm_messages_body_length" CHECK (char_length("body") >= 1 AND char_length("body") <= 5000)
);

CREATE INDEX IF NOT EXISTS "dm_messages_thread_id_created_at_idx"
  ON "dm_messages" ("thread_id", "created_at");

COMMIT;
