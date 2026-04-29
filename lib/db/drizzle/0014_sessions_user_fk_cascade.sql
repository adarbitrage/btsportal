-- Switches `sessions.user_id`'s foreign key to ON DELETE CASCADE so that
-- hard-deleting a user (admin delete flow or a manual fix-up) automatically
-- removes their session rows instead of leaving orphans behind that would
-- sit in the table until `auth-token-cleanup` eventually expires them.
--
-- Postgres does not support modifying an existing FK action in place, so we
-- drop the constraint and re-create it with the new ON DELETE rule.
--
-- Before re-adding the FK we first revoke + delete any pre-existing orphan
-- rows whose user_id no longer resolves to a real user. Without this, a
-- target environment that already accumulated orphans (e.g. from the old
-- /auth/refresh path that returned 401 "User not found" without revoking)
-- would fail the FK validation on re-add and the migration would abort.
-- The orphans are revoked first so that any in-flight /auth/refresh that
-- happens to race with this migration sees the revocation rather than the
-- row vanishing out from under it; the DELETE then removes the (now
-- already-revoked) rows in the same transaction.
--
-- Idempotent (DROP IF EXISTS, duplicate_object guard on ADD) so it is safe
-- to re-run against a database that already has the updated constraint
-- from `drizzle-kit push`.
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_user_id_users_id_fk";
--> statement-breakpoint
UPDATE "sessions"
    SET "revoked_at" = now()
    WHERE "revoked_at" IS NULL
      AND "user_id" NOT IN (SELECT "id" FROM "users");
--> statement-breakpoint
DELETE FROM "sessions"
    WHERE "user_id" NOT IN (SELECT "id" FROM "users");
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "sessions"
        ADD CONSTRAINT "sessions_user_id_users_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
