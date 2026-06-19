-- File attachments uploaded with compliance-review (and any future
-- attachment-capable ticket types). One row per file, rendered as clickable
-- download links on the admin ticket detail page.
--
-- Added directly to lib/db/src/schema/tickets.ts and only ever reached
-- databases via `drizzle-kit push`, with no companion .sql migration — so it
-- surfaced as `onlyInPush` drift in lib/db/src/migration-drift.test.ts. This
-- idempotent companion keeps the migration history in parity with the schema:
-- a no-op on a DB that already has the table (created via push) and the
-- canonical CREATE for a fresh migrate-only database.

CREATE TABLE IF NOT EXISTS "ticket_attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "ticket_id" integer NOT NULL REFERENCES "tickets"("id"),
  "object_path" text NOT NULL,
  "file_name" text,
  "file_size" integer,
  "content_type" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
