-- Pin the storage shape of `api_keys.permissions` to a JSONB array via a CHECK
-- constraint, mirroring the guard added in 0022 for `products.entitlement_keys`.
--
-- WHY THIS MATTERS HERE
-- `permissions` controls what each API key is allowed to do (auth scopes).
-- The same regression shape that hit `products.entitlement_keys` in #329 — a
-- stray `JSON.stringify([...])` in an inserter or admin tool double-encoding
-- through Drizzle's jsonb mapper — would land a JSONB string scalar here.
-- Drizzle's reader silently parses the string back into an array on the way
-- out, so the application would keep "working", but every JSONB array
-- operator (`@>`, `?`, `jsonb_array_elements_text`) would see a string and
-- silently grant zero permissions. For an auth-scope column, that is a
-- security-relevant silent failure, so the constraint goes in here too.
--
-- SAFE ORDERING — IMPORTANT
-- The constraint will fail to attach if any existing row is still a JSONB
-- string scalar. The block below first runs an idempotent UPDATE to repair
-- such rows so this script can be used as a one-shot fixer on an environment
-- whose data has not been touched yet.
--
-- This project uses `drizzle-kit push` for schema sync. The constraint is
-- ALSO defined in the Drizzle schema (`lib/db/src/schema/api-keys.ts`), so
-- `pnpm --filter db push` will attach it automatically on environments
-- where the data is already clean. This .sql file exists to:
--   1. Record the exact statement that was applied, for audit.
--   2. Give operators a single transactional script that does both the data
--      fix and the constraint addition in one shot, in case `drizzle-kit
--      push` fails to attach the constraint because the data is still bad.
--
-- The constraint addition is wrapped in an idempotent `pg_constraint
-- IF NOT EXISTS` guard so re-running this script (or running it after
-- `drizzle-kit push` has already attached the constraint via the schema
-- declaration) is a safe no-op rather than a hard error.
--
-- Scope: shape only (must be a JSONB array). Element typing is left to the
-- application layer, same boundary as 0022.
BEGIN;

-- 1. Repair any string-scalar rows. No-op if data is already clean.
UPDATE "api_keys"
SET "permissions" = ("permissions" #>> '{}')::jsonb
WHERE jsonb_typeof("permissions") = 'string';

-- 2. Add the CHECK constraint. NOT VALID is intentionally NOT used so the
--    server scans existing rows once and proves they all conform. After
--    this point Postgres rejects any INSERT/UPDATE that would land a
--    non-array value with SQLSTATE 23514 (check_violation). Idempotent
--    via `IF NOT EXISTS` against `pg_constraint`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'api_keys_permissions_is_array'
      AND conrelid = 'public.api_keys'::regclass
  ) THEN
    ALTER TABLE "api_keys"
      ADD CONSTRAINT "api_keys_permissions_is_array"
      CHECK (jsonb_typeof("permissions") = 'array');
  END IF;
END $$;

COMMIT;
