-- Bio split (Task #2043): coaches get a long description for the
-- private-coaching picker alongside the short group-card `bio`.
-- Idempotent; the boot hook backfillCoachLongBios copies bio -> long_bio once.
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS long_bio text;
