-- Transcript Cleaner admin-supplied cleaning inputs (Task #1560).
-- Additive, all nullable: the call type + authority (roster coach/VA or a bare
-- authority type) plus optional name/subject/date are captured at UPLOAD time
-- (batch default or per-file override) and become the ground truth for WHO/WHAT
-- while the AI decides WHICH turns belong to the authority. Unset values fall
-- back to a call-type default / AI guess, so no backfill is needed. Idempotent.
ALTER TABLE transcript_cleaner_documents
  ADD COLUMN IF NOT EXISTS provided_authority_role text,
  ADD COLUMN IF NOT EXISTS provided_authority_name text,
  ADD COLUMN IF NOT EXISTS provided_subject text,
  ADD COLUMN IF NOT EXISTS provided_date text;
