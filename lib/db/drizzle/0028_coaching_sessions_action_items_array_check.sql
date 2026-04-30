-- Pin the storage shape of `coaching_sessions.action_items` to a JSONB array
-- via a CHECK constraint, mirroring the guard added in 0022 for
-- `products.entitlement_keys`.
--
-- WHY THIS MATTERS HERE
-- `action_items` is a per-session list of `{ id, text, completed, ... }`
-- objects rendered by the coaching dashboard widget (which iterates
-- `recentSessionDetail.actionItems.filter(...)`). The same regression
-- shape that hit `products.entitlement_keys` in #329 — a stray
-- `JSON.stringify([...])` double-encoding through Drizzle's jsonb mapper —
-- would land a JSONB string scalar here. Drizzle's reader would silently
-- parse it back into an array on the way out, so the dashboard would keep
-- working, but any raw JSONB array operator (`@>`, `?`,
-- `jsonb_array_elements`) on this column would silently see zero items.
-- Reject the bad shape at the database layer.
--
-- NULLABILITY
-- `coaching_sessions.action_items` is nullable (a session is allowed to
-- have no action items at all). The constraint accordingly accepts NULL —
-- only a non-NULL value is required to be a JSONB array.
--
-- This project uses `drizzle-kit push` for schema sync. The constraint is
-- ALSO defined in the Drizzle schema (`lib/db/src/schema/coaching-sessions.ts`),
-- so `pnpm --filter db push` will attach it automatically on environments
-- where the data is already clean. This .sql file exists to:
--   1. Record the exact statement that was applied, for audit.
--   2. Give operators a single transactional script that does both the data
--      fix and the constraint addition in one shot.
--
-- The constraint addition is wrapped in an idempotent `pg_constraint
-- IF NOT EXISTS` guard so re-running this script is a safe no-op.
--
-- Scope: shape only (must be NULL or a JSONB array). Element typing is left
-- to the application layer, same boundary as 0022.
BEGIN;

UPDATE "coaching_sessions"
SET "action_items" = ("action_items" #>> '{}')::jsonb
WHERE jsonb_typeof("action_items") = 'string';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'coaching_sessions_action_items_is_array'
      AND conrelid = 'public.coaching_sessions'::regclass
  ) THEN
    ALTER TABLE "coaching_sessions"
      ADD CONSTRAINT "coaching_sessions_action_items_is_array"
      CHECK ("action_items" IS NULL OR jsonb_typeof("action_items") = 'array');
  END IF;
END $$;

COMMIT;
