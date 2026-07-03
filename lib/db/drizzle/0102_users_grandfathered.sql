-- Task #1643 (TB2): grandfather-backfill audit marker.
-- Additive column: idempotent, safe on a fresh or already-migrated DB.
-- Defaults to false; the one-time backfill (see
-- artifacts/api-server/src/lib/grandfather-backfill.ts) is the only writer
-- that ever sets it true, for members that pre-date the tiered onboarding
-- contract (Task #1640).

ALTER TABLE users ADD COLUMN IF NOT EXISTS grandfathered boolean NOT NULL DEFAULT false;
