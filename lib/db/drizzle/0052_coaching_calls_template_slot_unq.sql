-- 0052_coaching_calls_template_slot_unq.sql
-- Task: Group Coaching calendar — idempotent recurring-call generation.
--
-- Adds the `coaching_calls_template_slot_unq` UNIQUE (template_id, scheduled_at)
-- constraint so a recurring template never produces two calls for the same slot.
-- NULLs are distinct in Postgres, so one-off (template_id IS NULL) calls are
-- unaffected. Mirrors the unique() in lib/db/src/schema/coaching-calls.ts.
--
-- Applied explicitly here (and via sync-dev-db.sh for dev/tests) BEFORE the
-- live-schema-drift push gate. Without it, `drizzle-kit push --force` stops on a
-- non-`--force` prompt ("…add coaching_calls_template_slot_unq unique
-- constraint… Do you want to truncate coaching_calls table?") on a drifted DB
-- that already holds coaching_calls rows, which hangs/aborts a non-TTY
-- post-merge. Adding it up front makes push see it already exists and skip the
-- prompt.
--
-- Idempotent and fresh-DB safe: gated on the table existing (on an empty DB push
-- creates the table + constraint together, so this no-ops) and swallows
-- duplicate_object so it replays cleanly on an already-migrated database.

DO $$ BEGIN
  IF to_regclass('public.coaching_calls') IS NOT NULL THEN
    BEGIN
      ALTER TABLE coaching_calls
        ADD CONSTRAINT coaching_calls_template_slot_unq
        UNIQUE (template_id, scheduled_at);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN duplicate_table THEN NULL;
    END;
  END IF;
END $$;
