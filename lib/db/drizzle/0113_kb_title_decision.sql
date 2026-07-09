-- Task #1839: explicit accept/dismiss lifecycle for the AI title suggestion.
-- Additive, idempotent (fresh envs seed via these; the drift-gated post-merge
-- push covers prod). Values: 'accepted' | 'dismissed' | 'edited'; NULL = the
-- suggestion is still pending a reviewer decision.

ALTER TABLE kb_staging_docs ADD COLUMN IF NOT EXISTS ai_title_decision text;
