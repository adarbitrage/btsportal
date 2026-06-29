-- Tier 3a: checkout_idempotency table
-- Tracks in-flight and completed one-time checkout attempts so that the same
-- idempotency key is never charged twice.  All operations are idempotent so
-- re-running against an already-migrated database is a safe no-op.

CREATE TABLE IF NOT EXISTS "checkout_idempotency" (
  "id"              serial PRIMARY KEY NOT NULL,
  "idempotency_key" text NOT NULL,
  "user_id"         integer NOT NULL REFERENCES "users"("id"),
  "product_id"      integer NOT NULL REFERENCES "products"("id"),
  "status"          text NOT NULL,
  "order_id"        integer REFERENCES "bts_orders"("id"),
  "result"          jsonb,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at"    timestamp with time zone,
  CONSTRAINT "checkout_idempotency_idempotency_key_unique" UNIQUE ("idempotency_key")
);

DO $$ BEGIN
  ALTER TABLE "checkout_idempotency"
    ADD CONSTRAINT "checkout_idempotency_status_check"
      CHECK (status IN ('in_progress', 'completed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
