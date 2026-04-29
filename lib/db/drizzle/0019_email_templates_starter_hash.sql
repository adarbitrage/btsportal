-- Adds the `starter_hash` column to `email_templates` so we can tell whether
-- a row is still tracking the starter copy (hash matches) or has been
-- customized via the admin UI (hash is NULL). Used by
-- `ensureRequiredEmailTemplates` to safely refresh starter copy on existing
-- deployments without clobbering admin-edited templates.
--
-- Existing rows are left with NULL starter_hash. The seed routine performs a
-- one-time backfill on startup: rows whose current content matches a known
-- starter fingerprint (current or prior) are stamped with the new hash and
-- refreshed; rows that do not match are treated as customized and left alone.
--
-- Idempotent so it is safe to re-run against a database that already has the
-- column (e.g. created via `drizzle-kit push`).
ALTER TABLE "email_templates"
    ADD COLUMN IF NOT EXISTS "starter_hash" text;
