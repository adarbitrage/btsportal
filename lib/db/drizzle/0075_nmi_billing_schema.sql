-- NMI Billing Tier 2: products pricing columns + bts_orders + bts_order_items
-- Written idempotently (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, guarded DO blocks for constraints) so re-running
-- against an already-migrated database is a safe no-op.

-- ── 1. Extend the products table (additive columns only) ──────────────────────

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "price_cents"         integer,
  ADD COLUMN IF NOT EXISTS "currency"             text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS "billing_type"         text,
  ADD COLUMN IF NOT EXISTS "recurring_interval"   text,
  ADD COLUMN IF NOT EXISTS "item_type"            text DEFAULT 'entitlement',
  ADD COLUMN IF NOT EXISTS "is_native_nmi"        boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE "products"
    ADD CONSTRAINT "products_billing_type_check"
      CHECK (billing_type IS NULL OR billing_type IN ('one_time', 'recurring'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "products"
    ADD CONSTRAINT "products_recurring_interval_check"
      CHECK (recurring_interval IS NULL OR recurring_interval IN ('monthly', 'yearly'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "products"
    ADD CONSTRAINT "products_item_type_check"
      CHECK (item_type IS NULL OR item_type IN ('entitlement', 'wallet_topup'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Create bts_orders ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "bts_orders" (
  "id"                     serial PRIMARY KEY NOT NULL,
  "order_number"           text NOT NULL,
  "user_id"                integer REFERENCES "users"("id"),
  "email"                  text NOT NULL,
  "total_cents"            integer NOT NULL,
  "currency"               text NOT NULL DEFAULT 'USD',
  "status"                 text NOT NULL DEFAULT 'pending',
  "gateway_transaction_id" text,
  "order_type"             text NOT NULL,
  "metadata"               jsonb,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "bts_orders_order_number_unique" UNIQUE ("order_number")
);

DO $$ BEGIN
  ALTER TABLE "bts_orders"
    ADD CONSTRAINT "bts_orders_status_check"
      CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'partial_refunded'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bts_orders"
    ADD CONSTRAINT "bts_orders_order_type_check"
      CHECK (order_type IN ('one_time', 'recurring_initial', 'recurring_renewal', 'wallet_topup'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "bts_orders_user_id_idx"  ON "bts_orders" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "bts_orders_email_idx"    ON "bts_orders" USING btree ("email");
CREATE INDEX IF NOT EXISTS "bts_orders_status_idx"   ON "bts_orders" USING btree ("status");

-- ── 3. Create bts_order_items ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "bts_order_items" (
  "id"                        serial PRIMARY KEY NOT NULL,
  "order_id"                  integer NOT NULL REFERENCES "bts_orders"("id") ON DELETE CASCADE,
  "product_id"                integer REFERENCES "products"("id"),
  "description"               text,
  "unit_price_cents"          integer NOT NULL,
  "quantity"                  integer NOT NULL DEFAULT 1,
  "entitlement_keys_snapshot" jsonb,
  "created_at"                timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "bts_order_items_order_id_idx"
  ON "bts_order_items" USING btree ("order_id");
