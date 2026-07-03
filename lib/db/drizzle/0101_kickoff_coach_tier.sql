-- Task #1641: kickoff-coach tiering (Neil for LaunchPad).
-- Adds a member-tier bucket to kickoff_coaches so LaunchPad members can be
-- round-robined exclusively across a LaunchPad-only coach set, separate from
-- the existing 3-Month+ (Todd/Mark/Bruce) round-robin.
-- Idempotent: guarded ADD COLUMN, safe on a fresh or already-migrated DB.
-- Defaults every existing row to 'full' so current round-robin behavior for
-- Todd/Mark/Bruce is unchanged until the app-level seed explicitly sets
-- Neil's row to 'launchpad'.

ALTER TABLE kickoff_coaches ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'full';
