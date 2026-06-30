-- Transcript Cleaner: structured Vidalytics video id (Task #1520).
-- Adds the nullable `vidalytics_id` column that stores the source Vidalytics
-- video id captured (and safety-net cleaned) from a recognized Blitz caption
-- filename. It is the real, queryable key that links a captioned transcript to
-- every Blitz lesson the video appears in (placements derived live from the
-- guide). Additive + nullable, so existing rows are unaffected.
-- Idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to (re-)run via post-merge.
ALTER TABLE transcript_cleaner_documents
  ADD COLUMN IF NOT EXISTS vidalytics_id text;
