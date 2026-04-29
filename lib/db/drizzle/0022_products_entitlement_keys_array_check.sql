-- Pin the storage shape of `products.entitlement_keys` to a JSONB array via
-- a CHECK constraint, so a stray `JSON.stringify([...])` on the way in (the
-- bug fixed in #329) is rejected at the database layer instead of silently
-- producing a JSONB string scalar.
--
-- SAFE ORDERING — IMPORTANT
-- This constraint will fail to attach if any existing row is still a JSONB
-- string scalar (e.g. an environment that hasn't applied 0021 yet). The
-- block below first runs the same idempotent UPDATE that lives in
-- `0021_normalize_products_entitlement_keys.sql` so it can also be used as
-- a one-shot fixer on an environment that hasn't been touched yet.
--
-- This project uses `drizzle-kit push` for schema sync. The constraint is
-- ALSO defined in the Drizzle schema (`lib/db/src/schema/products.ts`), so
-- a normal post-merge `pnpm --filter db push` will attach it automatically
-- on environments where the data is already clean. This .sql file exists
-- for two reasons:
--   1. To record the exact statement that was applied, for audit.
--   2. To give operators a single transactional script that does both the
--      data fix and the constraint addition in one shot, in case
--      `drizzle-kit push` fails to attach the constraint because the data
--      is still bad.
--
-- The constraint addition is wrapped in an idempotent
-- `pg_constraint IF NOT EXISTS` guard so re-running this script (or
-- running it after `drizzle-kit push` has already attached the constraint
-- via the schema declaration) is a safe no-op rather than a hard error.
--
-- Scope: this only asserts the *shape* (must be a JSONB array). Element
-- typing (every element is a string) is intentionally left to the
-- application layer — the array-shape regression is the one we hit, and
-- the application already validates element types on the way in.
BEGIN;

-- 1. Repair any remaining string-scalar rows. No-op if 0021 already ran or
--    if `drizzle-kit push` already attached the constraint (in which case
--    no string scalars can exist by definition).
UPDATE "products"
SET "entitlement_keys" = ("entitlement_keys" #>> '{}')::jsonb
WHERE jsonb_typeof("entitlement_keys") = 'string';

-- 2. Add the CHECK constraint. NOT VALID is intentionally NOT used so the
--    server scans existing rows once and proves they all conform. After
--    this point Postgres rejects any INSERT/UPDATE that would land a
--    non-array value with SQLSTATE 23514 (check_violation). Idempotent
--    via `IF NOT EXISTS` against `pg_constraint`, so this script is safe
--    to re-run and safe to apply after `drizzle-kit push` has already
--    attached the constraint via the schema declaration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_entitlement_keys_is_array'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_entitlement_keys_is_array"
      CHECK (jsonb_typeof("entitlement_keys") = 'array');
  END IF;
END $$;

COMMIT;
