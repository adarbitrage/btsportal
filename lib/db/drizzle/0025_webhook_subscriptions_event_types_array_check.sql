-- Pin the storage shape of `webhook_subscriptions.event_types` to a JSONB
-- array via a CHECK constraint, mirroring the guard added in 0022 for
-- `products.entitlement_keys`.
--
-- WHY THIS MATTERS HERE
-- `event_types` drives the webhook fan-out: the dispatcher matches each
-- outgoing event against this list with `@>` / `?` to decide which
-- subscriptions get notified. The same regression shape that hit
-- `products.entitlement_keys` in #329 — a stray `JSON.stringify([...])` in an
-- inserter or admin tool double-encoding through Drizzle's jsonb mapper —
-- would land a JSONB string scalar here. JSONB array operators against a
-- string scalar return zero matches, so the subscription would silently
-- stop receiving events without any error surface. Reject that shape at
-- the database layer.
--
-- SAFE ORDERING — IMPORTANT
-- The constraint will fail to attach if any existing row is a JSONB string
-- scalar. The block below first runs an idempotent UPDATE that converts
-- such rows back to real arrays so this script can be used as a one-shot
-- fixer on an environment whose data has not been touched yet.
--
-- This project uses `drizzle-kit push` for schema sync. The constraint is
-- ALSO defined in the Drizzle schema (`lib/db/src/schema/webhook-subscriptions.ts`),
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

UPDATE "webhook_subscriptions"
SET "event_types" = ("event_types" #>> '{}')::jsonb
WHERE jsonb_typeof("event_types") = 'string';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'webhook_subscriptions_event_types_is_array'
      AND conrelid = 'public.webhook_subscriptions'::regclass
  ) THEN
    ALTER TABLE "webhook_subscriptions"
      ADD CONSTRAINT "webhook_subscriptions_event_types_is_array"
      CHECK (jsonb_typeof("event_types") = 'array');
  END IF;
END $$;

COMMIT;
