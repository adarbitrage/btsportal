-- Task #1868: always-on ceiling advisory for the KB AI Document Review flow.
--
-- The depth-ceiling proposal is re-evaluated on EVERY analysis run (even for
-- filed docs, whose home-root / node / doc-class suggestion is otherwise frozen)
-- and surfaced only when it differs from (or is missing on) the doc's current
-- ceiling. It rides two dedicated columns rather than aiSuggestedTaxonomy so it
-- can refresh without reopening the taxonomy lock.
--
-- Additive, idempotent (fresh envs seed via this; the drift-gated post-merge
-- push covers prod). Re-running against an already-migrated DB is a safe no-op.
ALTER TABLE kb_staging_docs ADD COLUMN IF NOT EXISTS ai_suggested_ceiling text;
ALTER TABLE kb_staging_docs ADD COLUMN IF NOT EXISTS ai_suggested_ceiling_reason text;
