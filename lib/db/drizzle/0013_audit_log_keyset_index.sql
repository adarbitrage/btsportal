-- Adds a composite btree index on (created_at, id) for the `audit_log`
-- table so the admin Audit Log endpoint can use keyset / cursor pagination
-- (ORDER BY created_at DESC, id DESC) without scanning huge prefixes.
--
-- The same index also backs `expand=<id>` deep-links: instead of counting
-- every preceding row to compute a page number, the endpoint now resolves
-- the target row's (created_at, id) and walks the index in O(log n + page).
--
-- Postgres can scan a btree in either direction, so a plain ascending
-- index works for both `ORDER BY ... DESC` and the ascending lookups used
-- when fetching the "newer" half of an expand window.
--
-- Idempotent so it is safe to re-run against a database that already has
-- the index from `drizzle-kit push`.
CREATE INDEX IF NOT EXISTS "audit_log_created_at_id_idx"
    ON "audit_log" ("created_at", "id");
