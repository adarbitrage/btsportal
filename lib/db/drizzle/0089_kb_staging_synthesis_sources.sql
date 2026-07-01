-- Synthesis-Engine multi-source provenance (Task #1533).
-- Additive, nullable jsonb column on kb_staging_docs holding the list of source
-- documents a synthesized truth-doc draft was consolidated from (each with its
-- source type, authority role, name, transcript-source soft-link, relevance).
-- Powers the review multi-source provenance panel and the per-source publish
-- provenance rows. Applying it explicitly here keeps the live-schema-drift gate
-- green so the conditional push stays skipped on the common merge. Idempotent
-- (ADD COLUMN IF NOT EXISTS).

ALTER TABLE kb_staging_docs
  ADD COLUMN IF NOT EXISTS synthesis_sources jsonb;
