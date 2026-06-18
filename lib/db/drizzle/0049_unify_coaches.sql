-- 0049_unify_coaches.sql
-- Task: unify the two coach rosters into a single `coaches` table.
--
-- The former `session_pack_coaches` (private/credit-pack roster) and `coaches`
-- (group-calls roster) are merged into ONE `coaches` table whose capability
-- flags (does_group_calls / does_private_coaching) say what each coach does.
-- Mirrors lib/db/src/schema/coaches.ts.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / DROP ... IF EXISTS / guarded DO blocks,
-- so it replays cleanly on dev, prod, and the migration-drift migrateDb.

-- 1. Additive columns on coaches.
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS does_group_calls boolean NOT NULL DEFAULT false;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS does_private_coaching boolean NOT NULL DEFAULT false;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS ghl_calendar_id text;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS ghl_location_id text;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- 2. bio / specialties are now nullable (group-only coaches need neither).
ALTER TABLE coaches ALTER COLUMN bio DROP NOT NULL;
ALTER TABLE coaches ALTER COLUMN specialties DROP NOT NULL;

-- 3. Drop the retired one-on-one flag (capability is now does_private_coaching).
ALTER TABLE coaches DROP COLUMN IF EXISTS one_on_one_enabled;

-- 4. Unique GHL calendar id (one coach per calendar). Required by the boot
--    seed's ON CONFLICT (ghl_calendar_id) upsert.
DO $$ BEGIN
  ALTER TABLE coaches ADD CONSTRAINT coaches_ghl_calendar_id_unique UNIQUE (ghl_calendar_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

-- 5. Migrate the existing private roster from session_pack_coaches into coaches
--    (match by ghl_calendar_id), preserving bio/photo. Both capabilities on.
--    No-op once session_pack_coaches is gone. ghl_location_id + flags are
--    reconciled by the idempotent boot seed (seedCoachRoster).
DO $$ BEGIN
  IF to_regclass('public.session_pack_coaches') IS NOT NULL THEN
    INSERT INTO coaches
      (name, bio, photo_url, ghl_calendar_id, sort_order, is_active, does_group_calls, does_private_coaching)
    SELECT name, bio, photo_url, ghl_calendar_id, sort_order, is_active, true, true
      FROM session_pack_coaches
     WHERE ghl_calendar_id IS NOT NULL
    ON CONFLICT (ghl_calendar_id) DO UPDATE SET
      does_group_calls = true,
      does_private_coaching = true,
      sort_order = EXCLUDED.sort_order,
      is_active = EXCLUDED.is_active;
  END IF;
END $$;

-- 6. Repoint session_pack_bookings.coach_id FK from session_pack_coaches to
--    coaches. Safe: zero private bookings exist at migration time.
DO $$ BEGIN
  ALTER TABLE session_pack_bookings
    DROP CONSTRAINT IF EXISTS session_pack_bookings_coach_id_session_pack_coaches_id_fk;
  ALTER TABLE session_pack_bookings
    ADD CONSTRAINT session_pack_bookings_coach_id_coaches_id_fk
    FOREIGN KEY (coach_id) REFERENCES coaches(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 7. Drop the now-redundant separate roster table.
DROP TABLE IF EXISTS session_pack_coaches CASCADE;
