-- Task #2001: near-miss band content-gap tagging. Additive boolean flag on
-- content_gap_questions marking rows whose MOST RECENT occurrence was rescued
-- by the chat semantic near-miss band (member got a hedged answer, but demand
-- only barely cleared retrieval). Separate flag — never encoded in
-- normalized_question, the dedup key. Idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE content_gap_questions
  ADD COLUMN IF NOT EXISTS near_miss_rescued boolean NOT NULL DEFAULT false;
