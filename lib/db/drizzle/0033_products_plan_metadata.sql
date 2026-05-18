-- Add the plan presentation metadata columns to `products` so admins can edit
-- tagline / highlights / "Most popular" badge / durationLabel from the admin
-- panel via PATCH /admin/products/:id, instead of those fields living in a
-- static PLAN_STATIC_METADATA map in `artifacts/api-server/src/lib/plans.ts`.
--
-- Each statement is idempotent so re-running this script against an already-
-- migrated database is a safe no-op.
--
-- This project uses `drizzle-kit push` for schema sync. The columns and the
-- `products_highlights_is_array` CHECK constraint are ALSO defined in the
-- Drizzle schema (`lib/db/src/schema/products.ts`), so a normal post-merge
-- `pnpm --filter db push` will attach them automatically on environments
-- where the data is already clean. This .sql file exists to record the
-- exact statements that were applied for audit, and to give operators a
-- single transactional script that does both the column adds and the
-- one-time backfill from PLAN_STATIC_METADATA in one shot.

BEGIN;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "tagline" text;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "duration_label" text;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "highlights" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "recommended" boolean NOT NULL DEFAULT false;

-- One-time backfill from the values that used to live in PLAN_STATIC_METADATA.
-- Only writes rows whose plan-metadata columns are still at their defaults
-- (tagline IS NULL AND highlights = '[]') so a re-run after an admin edit
-- never clobbers admin changes.

UPDATE "products" SET
  "tagline" = 'Get the BTS app suite and start building.',
  "duration_label" = 'One-time',
  "highlights" = '["Full BTS app suite","Compliance review submissions","Standard support","Full chat assistant access"]'::jsonb,
  "recommended" = false
WHERE "slug" = 'launchpad'
  AND "tagline" IS NULL
  AND "highlights" = '[]'::jsonb;

UPDATE "products" SET
  "tagline" = 'Group coaching, community, and commissions kick in.',
  "duration_label" = '90 days',
  "highlights" = '["Everything in LaunchPad","Live group coaching calls","Member community access","Entry-tier commissions","Enhanced support"]'::jsonb,
  "recommended" = false
WHERE "slug" = '3month'
  AND "tagline" IS NULL
  AND "highlights" = '[]'::jsonb;

UPDATE "products" SET
  "tagline" = 'Expanded software and mastermind coaching.',
  "duration_label" = '180 days',
  "highlights" = '["Everything in 3-Month","Expanded software access","Mastermind coaching","Mid-tier commissions","Unlimited support"]'::jsonb,
  "recommended" = false
WHERE "slug" = '6month'
  AND "tagline" IS NULL
  AND "highlights" = '[]'::jsonb;

UPDATE "products" SET
  "tagline" = 'Adds private monthly 1-on-1 coaching.',
  "duration_label" = '365 days',
  "highlights" = '["Everything in 6-Month","Monthly 1-on-1 coaching","Premium-tier commissions","Unlimited support"]'::jsonb,
  "recommended" = true
WHERE "slug" = '1year'
  AND "tagline" IS NULL
  AND "highlights" = '[]'::jsonb;

UPDATE "products" SET
  "tagline" = 'Weekly 1-on-1 coaching and lifetime access.',
  "duration_label" = 'Lifetime',
  "highlights" = '["Everything in 1-Year","Weekly 1-on-1 coaching","Top-tier commissions","VIP support","Custom chat assistant","No expiration"]'::jsonb,
  "recommended" = false
WHERE "slug" = 'lifetime'
  AND "tagline" IS NULL
  AND "highlights" = '[]'::jsonb;

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_highlights_is_array";

ALTER TABLE "products"
  ADD CONSTRAINT "products_highlights_is_array"
  CHECK (jsonb_typeof("highlights") = 'array');

COMMIT;
