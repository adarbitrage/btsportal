-- Enforce "at most one ACTIVE grant per (user, product)" on user_products.
--
-- Before this index, a double-insert race in the grant paths
-- (external grant API / webhook receivers) could leave two rows with
-- status='active' for the same (user_id, product_id). The partial unique
-- index makes that impossible going forward while leaving terminal rows
-- (expired / revoked / superseded) free to coexist as history — the
-- predicate only constrains active rows.
--
-- Prerequisite: any pre-existing duplicate active rows must be collapsed
-- to a single active row first (the rest set to a terminal status such as
-- 'superseded'), otherwise CREATE UNIQUE INDEX fails. That dedupe was done
-- as a one-time data fix on each environment; this file only creates the
-- index.
--
-- This project uses `drizzle-kit push` for schema sync. The index is also
-- defined in lib/db/src/schema/user-products.ts, so `pnpm --filter db push`
-- will apply it on environments that haven't run this file. This .sql file
-- exists to:
--   1. Record the exact statement for audit.
--   2. Give operators a script for manual application.
--
-- Idempotent: CREATE UNIQUE INDEX uses IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS "user_products_user_product_active_uidx"
  ON "user_products" ("user_id", "product_id")
  WHERE status = 'active';
