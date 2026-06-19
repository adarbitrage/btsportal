-- 0059_ticket_attachments_message_id.sql
-- Task: let members attach files when replying to a ticket.
--
-- Adds the nullable `message_id` FK column to `ticket_attachments`, linking an
-- attachment to the specific reply message it was uploaded with. Null for
-- attachments created at ticket-creation time (e.g. the initial Compliance
-- Review form), which predate any reply. Mirrors lib/db/src/schema/tickets.ts
-- (ticketAttachmentsTable.messageId -> ticketMessagesTable.id).
--
-- A pure ADDITIVE, nullable column. Added as a companion migration (not left as
-- a push-only change) because the live-schema-drift gate's globalSetup applies
-- the companion `.sql` files migrations-only (NO drizzle-kit push --force), so
-- the column must exist as an idempotent companion or the dev DB never gains it
-- and the gate fails. Idempotent: ADD COLUMN IF NOT EXISTS (the inline FK is
-- created with the column, so it is skipped too on replay). Replays cleanly on
-- dev, prod, and the migration-drift migrateDb.

ALTER TABLE ticket_attachments
  ADD COLUMN IF NOT EXISTS message_id integer REFERENCES ticket_messages(id);
