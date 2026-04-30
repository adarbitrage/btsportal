-- Pin the storage shape of the three `variables` JSONB columns in the
-- communications schema to a JSONB array via CHECK constraints, mirroring
-- the guard added in 0022 for `products.entitlement_keys`.
--
-- Columns covered (all `lib/db/src/schema/communications.ts`):
--   - `email_templates.variables`         (per-template variable list)
--   - `email_template_versions.variables` (snapshot of the above on save)
--   - `sms_templates.variables`           (per-SMS-template variable list)
--
-- WHY THIS MATTERS HERE
-- All three lists feed the template-render pipeline: the renderer iterates
-- the names to substitute placeholders, and the admin UI shows them as a
-- chip list. The same regression shape that hit `products.entitlement_keys`
-- in #329 — a stray `JSON.stringify([...])` double-encoding through
-- Drizzle's jsonb mapper — would land a JSONB string scalar in any of
-- these columns. Drizzle's reader silently parses the string back into an
-- array on the way out, so the application keeps working, but any raw
-- JSONB array operator (`@>`, `?`, `jsonb_array_elements_text`) on these
-- columns silently sees zero items, and any future migration off Drizzle
-- would render templates with every placeholder missing.
--
-- NULLABILITY
-- All three columns are nullable (a template is allowed to declare no
-- variables). The constraints accordingly accept NULL — only a non-NULL
-- value is required to be a JSONB array.
--
-- This project uses `drizzle-kit push` for schema sync. The constraints
-- are ALSO defined in the Drizzle schema, so `pnpm --filter db push` will
-- attach them automatically on environments where the data is already
-- clean. This .sql file exists to:
--   1. Record the exact statements that were applied, for audit.
--   2. Give operators a single transactional script that does both the data
--      fix and the constraint additions in one shot.
--
-- Each constraint addition is wrapped in an idempotent `pg_constraint
-- IF NOT EXISTS` guard so re-running this script is a safe no-op.
--
-- Scope: shape only (must be NULL or a JSONB array). Element typing is left
-- to the application layer, same boundary as 0022.
BEGIN;

-- 1. Repair any string-scalar rows.
UPDATE "email_templates"
SET "variables" = ("variables" #>> '{}')::jsonb
WHERE jsonb_typeof("variables") = 'string';

UPDATE "email_template_versions"
SET "variables" = ("variables" #>> '{}')::jsonb
WHERE jsonb_typeof("variables") = 'string';

UPDATE "sms_templates"
SET "variables" = ("variables" #>> '{}')::jsonb
WHERE jsonb_typeof("variables") = 'string';

-- 2. Attach the constraints (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_templates_variables_is_array'
      AND conrelid = 'public.email_templates'::regclass
  ) THEN
    ALTER TABLE "email_templates"
      ADD CONSTRAINT "email_templates_variables_is_array"
      CHECK ("variables" IS NULL OR jsonb_typeof("variables") = 'array');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_template_versions_variables_is_array'
      AND conrelid = 'public.email_template_versions'::regclass
  ) THEN
    ALTER TABLE "email_template_versions"
      ADD CONSTRAINT "email_template_versions_variables_is_array"
      CHECK ("variables" IS NULL OR jsonb_typeof("variables") = 'array');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sms_templates_variables_is_array'
      AND conrelid = 'public.sms_templates'::regclass
  ) THEN
    ALTER TABLE "sms_templates"
      ADD CONSTRAINT "sms_templates_variables_is_array"
      CHECK ("variables" IS NULL OR jsonb_typeof("variables") = 'array');
  END IF;
END $$;

COMMIT;
