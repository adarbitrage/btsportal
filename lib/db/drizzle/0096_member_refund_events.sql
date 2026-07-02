-- Daily NMI refund/chargeback poller: durable, idempotent event log.
-- Idempotent — safe to re-run against an already-migrated database.
--
-- `nmi_transaction_id` UNIQUE is the entire de-dup mechanism for the poller:
-- re-polling the same NMI transaction window inserts nothing new for
-- transactions already recorded (ON CONFLICT DO NOTHING in application code).

CREATE TABLE IF NOT EXISTS "member_refund_events" (
  "id"                 serial PRIMARY KEY NOT NULL,
  "member_id"          integer REFERENCES "users"("id"),
  "order_id"           integer REFERENCES "bts_orders"("id"),
  "order_number"       text,
  "type"               text NOT NULL,
  "amount_cents"       integer NOT NULL,
  "nmi_transaction_id" text NOT NULL UNIQUE,
  "matched"            boolean NOT NULL DEFAULT true,
  "occurred_at"        timestamp with time zone NOT NULL,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT member_refund_events_type_check
    CHECK ("type" IN ('refund', 'chargeback'))
);

CREATE INDEX IF NOT EXISTS "member_refund_events_member_id_idx"
  ON "member_refund_events" ("member_id");

CREATE INDEX IF NOT EXISTS "member_refund_events_occurred_at_idx"
  ON "member_refund_events" ("occurred_at");
