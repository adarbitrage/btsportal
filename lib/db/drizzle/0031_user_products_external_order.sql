-- Add external order tracking columns to user_products so non-ThriveCart
-- integrations (e.g. YSE) can record their own order IDs and source tags
-- without touching the existing thrivecart_order_id / thrivecart_sub_id
-- columns. The columns are purely additive — existing rows stay NULL and
-- the ThriveCart code paths are completely unaffected.
--
-- An index on (external_source, external_order_id) supports the idempotency
-- lookup in the YSE grant-product endpoint (O(log n) instead of a seq scan).
--
-- Each statement is idempotent so re-running this script against an already-
-- migrated database is a safe no-op.
--
-- Applied: see 0031_user_products_external_order.applied.md

ALTER TABLE "user_products"
  ADD COLUMN IF NOT EXISTS "external_order_id" text;

ALTER TABLE "user_products"
  ADD COLUMN IF NOT EXISTS "external_source" text;

CREATE INDEX IF NOT EXISTS "user_products_external_source_order_idx"
  ON "user_products" ("external_source", "external_order_id");
