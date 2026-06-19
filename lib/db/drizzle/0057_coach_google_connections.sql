-- Per-coach Google Drive OAuth connection (recording-ingest source of truth).
--
-- Added directly to lib/db/src/schema/coach-google-connections.ts and only ever
-- reached databases via `drizzle-kit push`, with no companion .sql migration —
-- so it surfaced as `onlyInPush` drift in lib/db/src/migration-drift.test.ts.
-- This idempotent companion keeps the migration history in parity with the
-- schema: a no-op on a DB that already has the table (created via push) and the
-- canonical CREATE for a fresh migrate-only database.
--
-- One row per portal user. The OAuth refresh token is stored AES-256-GCM
-- encrypted (refresh_token_enc); plaintext is never persisted.

CREATE TABLE IF NOT EXISTS "coach_google_connections" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "google_email" text NOT NULL,
  "refresh_token_enc" text NOT NULL,
  "scope" text,
  "status" text DEFAULT 'active' NOT NULL,
  "last_error" text,
  "last_sync_at" timestamp with time zone,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "coach_google_connections_user_id_unique" UNIQUE ("user_id")
);
