-- 0051_comms_send_log.sql
-- Task: comms-dedup send log (the checkAndRecordSend idempotency ledger).
--
-- Adds the `comms_send_log` table that records each (send_key, channel) the
-- comms layer has dispatched, so a retried/duplicate send is detected and
-- suppressed instead of double-firing. Mirrors lib/db/src/schema/comms-send-log.ts.
--
-- Applied explicitly here (and via sync-dev-db.sh for dev/tests) so the
-- live-schema-drift gate in post-merge sees the table already present and skips
-- the full `drizzle-kit push --force`. Idempotent: CREATE ... IF NOT EXISTS, so
-- it replays cleanly on dev, prod, and the migration-drift migrateDb.

CREATE TABLE IF NOT EXISTS comms_send_log (
  id serial PRIMARY KEY,
  send_key text NOT NULL,
  channel text NOT NULL,
  sent_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT comms_send_log_send_key_unique UNIQUE (send_key)
);
