-- Record the AI moderator's flag-threshold setting at the moment each
-- queue row was created. Needed by the admin "AI Flagged" view so admins
-- can see what threshold a historical flag was judged against and tell
-- whether their threshold tuning is catching too much or too little.
--
-- Nullable: wordlist-only flags ("wordlist_hard" / "wordlist_soft")
-- short-circuit the AI classifier and have no threshold to record, and
-- pre-existing rows from before this column was added are left null.
ALTER TABLE moderation_queue ADD COLUMN IF NOT EXISTS flag_threshold real;
