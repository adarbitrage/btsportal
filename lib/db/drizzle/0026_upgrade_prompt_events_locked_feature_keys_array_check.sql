-- Pin the storage shape of `upgrade_prompt_events.locked_feature_keys` to a
-- JSONB array via a CHECK constraint, mirroring the guard added in 0022 for
-- `products.entitlement_keys`.
--
-- WHY THIS MATTERS HERE
-- `locked_feature_keys` records which feature keys triggered an upgrade
-- prompt; analytics queries (`?`, `jsonb_array_elements_text`) bucket events
-- by those keys to drive the prompt-impression / CTR dashboards. The same
-- regression shape that hit `products.entitlement_keys` in #329 — a stray
-- `JSON.stringify([...])` double-encoding through Drizzle's jsonb mapper —
-- would land a JSONB string scalar here. JSONB array operators against a
-- string scalar return zero matches, so any analytics roll-up grouped by
-- locked feature key would silently report zero. Reject that shape at the
-- database layer.
--
-- SAFE ORDERING — IMPORTANT
-- The constraint will fail to attach if any existing row is a JSONB string
-- scalar. The block below first runs an idempotent UPDATE so this script
-- can be used as a one-shot fixer.
--
-- This project uses `drizzle-kit push` for schema sync. The constraint is
-- ALSO defined in the Drizzle schema (`lib/db/src/schema/upgrade-prompt-events.ts`),
-- so `pnpm --filter db push` will attach it automatically on environments
-- where the data is already clean. This .sql file exists to:
--   1. Record the exact statement that was applied, for audit.
--   2. Give operators a single transactional script that does both the data
--      fix and the constraint addition in one shot.
--
-- The constraint addition is wrapped in an idempotent `pg_constraint
-- IF NOT EXISTS` guard so re-running this script is a safe no-op.
--
-- Scope: shape only (must be a JSONB array). Element typing is left to the
-- application layer, same boundary as 0022.
BEGIN;

UPDATE "upgrade_prompt_events"
SET "locked_feature_keys" = ("locked_feature_keys" #>> '{}')::jsonb
WHERE jsonb_typeof("locked_feature_keys") = 'string';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'upgrade_prompt_events_locked_feature_keys_is_array'
      AND conrelid = 'public.upgrade_prompt_events'::regclass
  ) THEN
    ALTER TABLE "upgrade_prompt_events"
      ADD CONSTRAINT "upgrade_prompt_events_locked_feature_keys_is_array"
      CHECK (jsonb_typeof("locked_feature_keys") = 'array');
  END IF;
END $$;

COMMIT;
