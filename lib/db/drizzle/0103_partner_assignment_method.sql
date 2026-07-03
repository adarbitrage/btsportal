-- Task #1654: soonest-availability-first partner assignment. Records which
-- selection strategy produced each partner_assignments row: "soonest" (the
-- GHL earliest-bookable-slot probe succeeded) or "fallback_fewest_active"
-- (the probe timed out/errored, or every candidate had zero surviving
-- slots, and assignment fell back to the pre-existing fewest-active rule).
-- Idempotent guarded ADD COLUMN, safe on a fresh or already-migrated DB.
-- Defaults every existing row to 'fallback_fewest_active' since none of the
-- historical rows were produced by the new soonest-first logic.

ALTER TABLE partner_assignments ADD COLUMN IF NOT EXISTS assignment_method text NOT NULL DEFAULT 'fallback_fewest_active';
