-- Task #1611: per-row GHL location for partners + kickoff coaches.
-- The accountability-partner and kickoff-coach calendars live in the
-- "Build Test Scale" sub-account, not the coaching location the call-bookings
-- routes previously hardcoded — a token minted for the wrong location 401s.
-- Idempotent: guarded ADD COLUMN, safe to apply on an already-migrated or
-- fresh database. Default matches COACHING_LOCATION_ID in
-- ghl-coaching-calendar.ts so existing rows/behavior are unchanged until
-- explicitly updated with their real location.

ALTER TABLE partners ADD COLUMN IF NOT EXISTS ghl_location_id text NOT NULL DEFAULT 'JI6HzFwkNIr5VA2QUWUL';
ALTER TABLE kickoff_coaches ADD COLUMN IF NOT EXISTS ghl_location_id text NOT NULL DEFAULT 'JI6HzFwkNIr5VA2QUWUL';
