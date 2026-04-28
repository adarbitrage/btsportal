-- Deduplicate any rows in `member_app_instances` that violate the
-- (user_id, app_name) uniqueness rule, then make sure the unique index that
-- enforces it is actually present.
--
-- Some early Flexy installs produced multiple rows for the same
-- (user_id, app_name) pair (e.g. user_id=11/app_name='flexy' had two empty
-- stubs alongside the real, populated row). The admin Flexy lookup endpoint
-- used `.limit(1)` and so worked _most_ of the time, but if the wrong row was
-- returned the lookup incorrectly reported the member had no Flexy install.
--
-- Strategy
--   For every (user_id, app_name) with more than one row we keep the single
--   "best" row and delete the rest. "Best" prefers, in order:
--     1. Has provider_staff_user_id populated  (the real provisioned user)
--     2. Has provider_location_id populated    (a real GHL sub-account)
--     3. Status is one of installed/installing (real lifecycle, not a stub)
--     4. Most recent updated_at                (most recent activity wins)
--     5. Lowest id                             (deterministic tiebreaker)
--
-- This is safe to re-run: in the steady state there are no duplicates, so
-- the CTE selects nothing and the DELETE is a no-op.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, app_name
      ORDER BY
        (provider_staff_user_id IS NOT NULL) DESC,
        (provider_location_id IS NOT NULL)   DESC,
        (status IN ('installed', 'installing')) DESC,
        updated_at DESC,
        id ASC
    ) AS rn
  FROM member_app_instances
)
DELETE FROM member_app_instances mai
USING ranked r
WHERE mai.id = r.id
  AND r.rn > 1;

-- Guarantee the unique constraint exists. The schema in
-- lib/db/src/schema/member-app-instances.ts declares it, and `drizzle-kit
-- push` should have created it, but historically some environments ended up
-- with the duplicates above which suggests the index was at one point
-- missing. Adding it idempotently makes the production state authoritative.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'member_app_instances_user_app_unique'
      AND conrelid = 'public.member_app_instances'::regclass
  ) THEN
    ALTER TABLE "member_app_instances"
      ADD CONSTRAINT "member_app_instances_user_app_unique"
      UNIQUE ("user_id", "app_name");
  END IF;
END $$;
