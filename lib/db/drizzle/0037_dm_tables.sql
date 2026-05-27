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
--
-- Idempotent: tables / indexes use IF NOT EXISTS, and the FK / UNIQUE /
-- CHECK constraints are added via DO blocks so they are attached even when
-- the tables already exist from `drizzle-kit push`. Shares idx 0037 with
-- 0037_community_status_media_urls.sql, which touches disjoint tables.

BEGIN;

CREATE TABLE IF NOT EXISTS "dm_threads" (
  "id"              serial PRIMARY KEY NOT NULL,
  "member_id"       integer NOT NULL,
  "admin_id"        integer NOT NULL,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
  "last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "dm_threads"
    ADD CONSTRAINT "dm_threads_member_id_users_id_fk"
    FOREIGN KEY ("member_id") REFERENCES "users" ("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dm_threads"
    ADD CONSTRAINT "dm_threads_admin_id_users_id_fk"
    FOREIGN KEY ("admin_id") REFERENCES "users" ("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dm_threads"
    ADD CONSTRAINT "dm_threads_member_admin_unique" UNIQUE ("member_id", "admin_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table  THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "dm_threads_last_message_at_idx"
  ON "dm_threads" ("last_message_at");

CREATE TABLE IF NOT EXISTS "dm_messages" (
  "id"         serial PRIMARY KEY NOT NULL,
  "thread_id"  integer NOT NULL,
  "sender_id"  integer NOT NULL,
  "body"       text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at"    timestamp with time zone
);

DO $$ BEGIN
  ALTER TABLE "dm_messages"
    ADD CONSTRAINT "dm_messages_thread_id_dm_threads_id_fk"
    FOREIGN KEY ("thread_id") REFERENCES "dm_threads" ("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dm_messages"
    ADD CONSTRAINT "dm_messages_sender_id_users_id_fk"
    FOREIGN KEY ("sender_id") REFERENCES "users" ("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dm_messages"
    ADD CONSTRAINT "dm_messages_body_length"
    CHECK (char_length("body") >= 1 AND char_length("body") <= 5000);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "dm_messages_thread_id_created_at_idx"
  ON "dm_messages" ("thread_id", "created_at");

COMMIT;
