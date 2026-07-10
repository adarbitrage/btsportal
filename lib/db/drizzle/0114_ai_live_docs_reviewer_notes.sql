-- Task #1851: additive, nullable reviewer-notes column on ai_live_documents.
-- Set from the KB review screen when a reviewer (refining a different draft)
-- opts to leave a note on THIS live doc about an overlap flagged elsewhere.
-- Additive + all-nullable, so it is applied idempotently here (ADD COLUMN IF
-- NOT EXISTS) to reach prod even when the live-schema-drift gate short-circuits
-- the full push. No backfill — NULL means "no reviewer notes".
ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS reviewer_notes text;
