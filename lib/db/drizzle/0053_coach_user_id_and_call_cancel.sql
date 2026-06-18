-- 0053_coach_user_id_and_call_cancel.sql
-- Task: Group Coaching calendar + admin coach picker.
--
-- Adds the schema columns the live-schema-drift gate flagged as present in
-- lib/db/src/schema/*.ts but missing from a drifted dev/prod database:
--
--   * coaches.user_id        — optional link from a coach roster row to the
--                              coach's portal login (users.role = "coach") so a
--                              signed-in coach resolves to their own calls.
--                              Nullable, UNIQUE, FK -> users(id) ON DELETE SET NULL.
--                              Mirrors coachesTable.userId in schema/coaches.ts.
--   * coaching_calls.cancelled_at / cancelled_by
--                            — soft-cancel marker for a single occurrence (the
--                              row is kept, not deleted, so the slot stays
--                              occupied and regeneration won't resurrect it).
--                              Both nullable; cancelled_by FK -> users(id)
--                              ON DELETE SET NULL. Mirrors coachingCallsTable in
--                              schema/coaching-calls.ts.
--
-- Applied explicitly here (and via sync-dev-db.sh for dev/tests) so the
-- live-schema-drift gate in post-merge sees these columns already present and
-- skips the full `drizzle-kit push --force`. Idempotent: ADD COLUMN IF NOT
-- EXISTS plus guarded constraint adds, so it replays cleanly on dev, prod, and
-- the migration-drift migrateDb.

ALTER TABLE coaches ADD COLUMN IF NOT EXISTS user_id integer;

DO $$ BEGIN
  ALTER TABLE coaches ADD CONSTRAINT coaches_user_id_unique UNIQUE (user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE coaches ADD CONSTRAINT coaches_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE coaching_calls ADD COLUMN IF NOT EXISTS cancelled_at timestamp with time zone;
ALTER TABLE coaching_calls ADD COLUMN IF NOT EXISTS cancelled_by integer;

DO $$ BEGIN
  ALTER TABLE coaching_calls ADD CONSTRAINT coaching_calls_cancelled_by_users_id_fk
    FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
