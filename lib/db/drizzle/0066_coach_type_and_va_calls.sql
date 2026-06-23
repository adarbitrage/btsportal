-- Coach type + VA capability.
--
-- Adds the `type` discriminator ("strategic_coach" | "va") and the
-- `does_one_on_one_va_calls` capability flag to the unified `coaches` roster.
-- Both are pure additive columns with NOT NULL DEFAULT, so existing rows keep
-- their current behaviour (everyone defaults to a strategic coach who offers no
-- VA calls). Idempotent (ADD COLUMN IF NOT EXISTS) so re-running is a no-op and
-- it replays cleanly on top of a database drizzle-kit push already migrated.
ALTER TABLE coaches
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'strategic_coach';

ALTER TABLE coaches
  ADD COLUMN IF NOT EXISTS does_one_on_one_va_calls boolean NOT NULL DEFAULT false;
