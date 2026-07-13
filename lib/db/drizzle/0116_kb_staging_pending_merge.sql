-- Task #1902: unconfirmed AI merge drafts on the Possible Duplicates screen.
-- Additive, nullable jsonb column: the staging-doc ids a persisted (but not yet
-- confirmed) AI merge draft proposes to replace. Cleared on confirm; the draft
-- is soft-deleted on discard.
ALTER TABLE kb_staging_docs ADD COLUMN IF NOT EXISTS pending_merge_source_ids jsonb;
