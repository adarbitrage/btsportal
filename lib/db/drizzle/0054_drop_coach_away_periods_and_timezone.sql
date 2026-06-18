-- 0054_drop_coach_away_periods_and_timezone.sql
-- Task: remove the "away periods" feature and the vestigial coach timezone.
--
-- Coaches now signal absences through their own Google Calendar, so the
-- coach_away_periods table and its supporting lib are gone. The
-- admin-controlled coaches.timezone column had zero functional reads
-- (scheduling uses the system-wide COACHING_TIMEZONE); the single source of
-- truth for a coach's timezone is their own Account page (users.timezone).
--
-- Both are pure REMOVALS, so the live-schema-drift gate (which only asserts
-- schema ⊆ DB) stays green and `drizzle-kit push --force` would never fire to
-- apply them. Drop them explicitly here, like the other table-removal
-- migrations. Idempotent: IF EXISTS so it replays cleanly on dev and prod.
DROP TABLE IF EXISTS coach_away_periods CASCADE;
ALTER TABLE coaches DROP COLUMN IF EXISTS timezone;
