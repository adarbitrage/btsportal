-- Pin the storage shape of the two `action_items` JSONB columns in the
-- lessons schema to a JSONB array via CHECK constraints, mirroring the
-- guard added in 0028 for `coaching_sessions.action_items`.
--
-- Columns covered:
--   - `lessons.action_items`         (per-lesson checklist)
--   - `lesson_versions.action_items` (snapshot of the above on save)
--
-- WHY THIS MATTERS HERE
-- Both columns are a per-lesson list of `{ id, text, sortOrder }` objects
-- rendered as a checklist by the lesson page (`LessonView` iterates
-- `lessonData.actionItems.map(...)`) and edited by the admin lesson editor
-- (`ActionItemsEditor`). The same regression shape that hit
-- `products.entitlement_keys` in #329 — a stray `JSON.stringify([...])`
-- double-encoding through Drizzle's jsonb mapper — would land a JSONB
-- string scalar here. Drizzle's reader would silently parse it back into
-- an array on the way out, so the API would keep returning data, but any
-- raw JSONB array operator (`@>`, `?`, `jsonb_array_elements`) on these
-- columns would silently see zero items, and the `.map(...)` call on the
-- lesson page would render a blank checklist with no error in the logs.
-- Reject the bad shape at the database layer.
--
-- NULLABILITY
-- Both columns are nullable (a lesson is allowed to have no action items
-- at all). The constraints accordingly accept NULL — only a non-NULL
-- value is required to be a JSONB array.
--
-- This project uses `drizzle-kit push` for schema sync. The constraints
-- are ALSO defined in the Drizzle schema (`lib/db/src/schema/lessons.ts`
-- and `lib/db/src/schema/lesson-versions.ts`), so `pnpm --filter db push`
-- will attach them automatically on environments where the data is
-- already clean. This .sql file exists to:
--   1. Record the exact statements that were applied, for audit.
--   2. Give operators a single transactional script that does both the
--      data fix and the constraint additions in one shot.
--
-- Each constraint addition is wrapped in an idempotent `pg_constraint
-- IF NOT EXISTS` guard so re-running this script is a safe no-op.
--
-- Scope: shape only (must be NULL or a JSONB array). Element typing is
-- left to the application layer, same boundary as 0022.
BEGIN;

-- 1. Repair any string-scalar rows.
UPDATE "lessons"
SET "action_items" = ("action_items" #>> '{}')::jsonb
WHERE jsonb_typeof("action_items") = 'string';

UPDATE "lesson_versions"
SET "action_items" = ("action_items" #>> '{}')::jsonb
WHERE jsonb_typeof("action_items") = 'string';

-- 2. Attach the constraints (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lessons_action_items_is_array'
      AND conrelid = 'public.lessons'::regclass
  ) THEN
    ALTER TABLE "lessons"
      ADD CONSTRAINT "lessons_action_items_is_array"
      CHECK ("action_items" IS NULL OR jsonb_typeof("action_items") = 'array');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lesson_versions_action_items_is_array'
      AND conrelid = 'public.lesson_versions'::regclass
  ) THEN
    ALTER TABLE "lesson_versions"
      ADD CONSTRAINT "lesson_versions_action_items_is_array"
      CHECK ("action_items" IS NULL OR jsonb_typeof("action_items") = 'array');
  END IF;
END $$;

COMMIT;
