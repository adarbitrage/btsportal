-- Add external order tracking columns to user_products so rows created via
-- the external grant-product API can be traced back to their originating
-- system and order, and so idempotent lookups are efficient.
--
-- Columns added (both nullable, additive — no existing columns changed):
--   external_order_id TEXT  — the order ID from the external system (e.g. YSE order ID)
--   external_source   TEXT  — the system name (e.g. "yse"); enables multi-tenant idempotency
--
-- Index: (external_source, external_order_id) to support the idempotency
-- lookup in handleExternalGrantProduct without a full table scan.
--
-- This project uses `drizzle-kit push` for schema sync. The columns and
-- index are also defined in lib/db/src/schema/user-products.ts, so
-- `pnpm --filter db push` will apply them on environments that haven't
-- run this file. This .sql file exists to:
--   1. Record the exact statements for audit.
--   2. Give operators a transactional script for manual application.
--
-- Idempotent: each ALTER is guarded by an IF NOT EXISTS check on the
-- information_schema. The CREATE INDEX uses IF NOT EXISTS.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_products'
      AND column_name  = 'external_order_id'
  ) THEN
    ALTER TABLE "user_products" ADD COLUMN "external_order_id" TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_products'
      AND column_name  = 'external_source'
  ) THEN
    ALTER TABLE "user_products" ADD COLUMN "external_source" TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "user_products_external_order_idx"
  ON "user_products" ("external_source", "external_order_id");

COMMIT;
