-- The direct-messaging (DM) feature was removed entirely (portal pages,
-- coach messaging, /api/dm backend). Both tables were verified empty
-- (0 rows) before removal. Idempotent so it is safe to re-run in every
-- environment; dm_messages FK-references dm_threads, so drop it first.
DROP TABLE IF EXISTS dm_messages CASCADE;
DROP TABLE IF EXISTS dm_threads CASCADE;
