-- Pin the storage shape of `vault_resources.tags` to a JSONB array via a
-- CHECK constraint, mirroring the guard added in 0022 for
-- `products.entitlement_keys`.
--
-- WHY THIS MATTERS HERE
-- `tags` is the per-resource tag list. The admin tag-listing endpoint
-- (`/admin/vault/tags`) iterates `Array.isArray(r.tags)` and unions the
-- elements; the vault search/filter UI treats it as an array. The same
-- regression shape that hit `products.entitlement_keys` in #329 already
-- happened here: the original `seed-vault.ts` passed
-- `tags: JSON.stringify([...])` for every row, so Drizzle's jsonb mapper
-- double-encoded the value and landed a JSONB string scalar. Drizzle's
-- reader silently parsed it back into an array on the way out — the admin
-- tag list saw a string, hit `Array.isArray === false`, and dropped every
-- tag from those rows on the floor. Reject the bad shape at the database
-- layer.
--
-- DATA REPAIR
-- The seed has been corrected to insert real arrays (see
-- `artifacts/api-server/src/lib/seed-vault.ts`), so a fresh DB will not
-- reintroduce the bug. This migration also repairs already-affected rows
-- in environments whose data was written before the seed fix; the UPDATE
-- only touches rows whose value is a string scalar, so the statement is
-- idempotent and safe to re-run.
--
-- NULLABILITY
-- `vault_resources.tags` is nullable (a resource is allowed to have no
-- tags at all). The constraint accordingly accepts NULL — only a non-NULL
-- value is required to be a JSONB array.
--
-- This project uses `drizzle-kit push` for schema sync. The constraint is
-- ALSO defined in the Drizzle schema (`lib/db/src/schema/vault-resources.ts`),
-- so `pnpm --filter db push` will attach it automatically on environments
-- where the data is already clean. This .sql file exists to:
--   1. Record the exact statement that was applied, for audit.
--   2. Give operators a single transactional script that does both the data
--      fix and the constraint addition in one shot, in case `drizzle-kit
--      push` fails to attach the constraint because the data is still bad
--      (which it currently is on every environment seeded before the
--      seed-vault fix).
--
-- The constraint addition is wrapped in an idempotent `pg_constraint
-- IF NOT EXISTS` guard so re-running this script is a safe no-op.
--
-- Scope: shape only (must be NULL or a JSONB array). Element typing is left
-- to the application layer, same boundary as 0022.
BEGIN;

UPDATE "vault_resources"
SET "tags" = ("tags" #>> '{}')::jsonb
WHERE jsonb_typeof("tags") = 'string';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vault_resources_tags_is_array'
      AND conrelid = 'public.vault_resources'::regclass
  ) THEN
    ALTER TABLE "vault_resources"
      ADD CONSTRAINT "vault_resources_tags_is_array"
      CHECK ("tags" IS NULL OR jsonb_typeof("tags") = 'array');
  END IF;
END $$;

COMMIT;
