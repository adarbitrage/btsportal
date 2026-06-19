-- 0056_ticket_attachments.sql
-- Task: store file attachments uploaded with compliance-review tickets.
--
-- Adds the `ticket_attachments` table (one row per uploaded file) that the
-- admin ticket detail page queries to render clickable download links.
-- Mirrors lib/db/src/schema/tickets.ts (ticketAttachmentsTable).
--
-- A pure ADDITIVE table. Applied explicitly here (and via the post-merge step)
-- so the live-schema-drift gate sees the table already present and the common
-- merge skips the slow full `drizzle-kit push --force`. Idempotent:
-- CREATE TABLE IF NOT EXISTS, so it replays cleanly on dev, prod, and the
-- migration-drift migrateDb.

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id serial PRIMARY KEY,
  ticket_id integer NOT NULL REFERENCES tickets(id),
  object_path text NOT NULL,
  file_name text,
  file_size integer,
  content_type text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
