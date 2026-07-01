-- Synthesis Engine Part 3 (Task #1535): update-vs-create link on staging drafts.
-- Additive, nullable columns so existing staging rows keep working untouched.
-- Idempotent (ADD COLUMN IF NOT EXISTS) — safe to re-run and a no-op on a fresh
-- DB where drizzle-kit push already created the columns.
ALTER TABLE kb_staging_docs ADD COLUMN IF NOT EXISTS update_kind text;
ALTER TABLE kb_staging_docs ADD COLUMN IF NOT EXISTS target_live_doc_id integer;
ALTER TABLE kb_staging_docs ADD COLUMN IF NOT EXISTS update_summary text;
