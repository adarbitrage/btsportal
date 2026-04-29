-- Normalize products.entitlement_keys from JSONB string scalars (a serialized
-- array stored as a JSON-encoded string) into real JSONB arrays.
--
-- Background: the original product seed code passed
-- `JSON.stringify([...])` for the `entitlement_keys` JSONB column. Drizzle's
-- jsonb mapper then ran JSON.stringify on that already-serialized string a
-- second time, so every row landed in Postgres as a JSONB string scalar
-- (e.g. `"[\"content:frontend\",\"support:basic\"]"`) instead of a JSONB
-- array. Drizzle's reader silently parses the string back into an array on
-- the way out, so the application kept working — but any direct pg client
-- query, raw SQL JSONB operator (`jsonb_array_elements_text`, `?`, `@>`),
-- or future ORM swap saw a string and silently granted zero entitlements.
--
-- The seed has been corrected to insert real arrays (see
-- `artifacts/api-server/src/seed.ts`), so a fresh DB will not reintroduce
-- the bug. This migration repairs already-affected rows in environments
-- whose data was written before the seed fix.
--
-- The conversion only touches rows whose value is a string scalar, so the
-- statement is idempotent and safe to re-run after a partial application or
-- against an environment where some rows have already been fixed.
--
-- This project uses `drizzle-kit push` for schema sync, which does not
-- apply data migrations. The SQL below is intended to be run manually
-- (psql, executeSql, or the platform's SQL console) once per environment.
UPDATE "products"
SET "entitlement_keys" = ("entitlement_keys" #>> '{}')::jsonb
WHERE jsonb_typeof("entitlement_keys") = 'string';
