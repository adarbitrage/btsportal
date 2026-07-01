-- Synthesis Engine Part 2 (Task #1534): per-source "incorporated" marker.
-- Additive, nullable — brand-new sources land with NULL, meaning the incremental
-- synthesis run has not yet folded them into any node. Idempotent.
ALTER TABLE ai_source_documents
  ADD COLUMN IF NOT EXISTS incorporated_at timestamptz;
