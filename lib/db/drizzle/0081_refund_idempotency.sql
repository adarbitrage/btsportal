-- NMI Tier 7: refund_idempotency table
-- Idempotent — safe to re-run against an already-migrated database.
-- Stores in-flight and completed refund attempts keyed by caller idempotency key.

CREATE TABLE IF NOT EXISTS "refund_idempotency" (
  "id"               serial PRIMARY KEY NOT NULL,
  "idempotency_key"  text NOT NULL UNIQUE,
  "order_number"     text NOT NULL,
  "amount_cents"     integer,
  "status"           text NOT NULL,
  "result"           jsonb,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at"     timestamp with time zone,
  CONSTRAINT refund_idempotency_status_check
    CHECK (status IN ('in_progress', 'completed'))
);

CREATE INDEX IF NOT EXISTS "refund_idempotency_order_number_idx"
  ON "refund_idempotency" ("order_number");
