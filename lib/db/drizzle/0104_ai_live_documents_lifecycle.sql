-- Task #1665: Live AI Documents lifecycle. Additive, nullable columns so existing
-- rows keep working. Idempotent (ADD COLUMN IF NOT EXISTS) so a re-run on a
-- drifted/partially-migrated database is a no-op.
--
--   deleted_at       — soft-delete tombstone; NULL = live. Excluded from every
--                      retrieval path when set, but the row is preserved so an
--                      admin can restore it. Nothing is ever hard-deleted.
--   flagged_stale_at — automated "source changed" signal timestamp; drives the
--                      "likely needs updating" badge in the admin UI.
--   flagged_reason   — human-readable reason for the stale flag.
ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS flagged_stale_at timestamptz;
ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS flagged_reason text;
