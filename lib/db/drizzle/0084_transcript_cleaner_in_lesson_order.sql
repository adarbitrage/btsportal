-- Transcript Cleaner: in-lesson video order (Task #1520).
-- Adds the nullable `in_lesson_order` column used to preserve the 1-based order
-- of a video within its lesson when Blitz caption filenames are auto-recognized
-- on upload. Additive + nullable, so existing rows are unaffected.
-- Idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to (re-)run via post-merge.
ALTER TABLE transcript_cleaner_documents
  ADD COLUMN IF NOT EXISTS in_lesson_order integer;
