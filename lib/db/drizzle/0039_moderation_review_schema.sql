-- Make the moderation review schema part of the official migrations.
-- Adds the columns and tables that the moderation/admin code relies on
-- (previously only defined in the Drizzle schema and patched into dev
-- with ad-hoc ALTERs). Idempotent so it's safe to re-run.

-- 1. users.posting_banned_at — set when an admin bans a member from posting.
ALTER TABLE users ADD COLUMN IF NOT EXISTS posting_banned_at timestamp with time zone;

-- 2. moderation_wordlist — admin-managed list of flagged words.
CREATE TABLE IF NOT EXISTS moderation_wordlist (
  id serial PRIMARY KEY,
  word text NOT NULL UNIQUE,
  category text NOT NULL,
  severity text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moderation_wordlist_severity_idx ON moderation_wordlist (severity);
CREATE INDEX IF NOT EXISTS moderation_wordlist_category_idx ON moderation_wordlist (category);

-- 3. moderation_queue — items awaiting human review.
CREATE TABLE IF NOT EXISTS moderation_queue (
  id serial PRIMARY KEY,
  target_type text NOT NULL,
  target_id integer NOT NULL,
  author_id integer NOT NULL REFERENCES users(id),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  triggered_by text NOT NULL,
  wordlist_matches jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by integer REFERENCES users(id),
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moderation_queue_status_idx ON moderation_queue (status);
CREATE INDEX IF NOT EXISTS moderation_queue_author_idx ON moderation_queue (author_id);
CREATE INDEX IF NOT EXISTS moderation_queue_target_idx ON moderation_queue (target_type, target_id);
CREATE INDEX IF NOT EXISTS moderation_queue_created_idx ON moderation_queue (created_at);

-- 4. user_strikes — strike history attached to users / queue entries.
CREATE TABLE IF NOT EXISTS user_strikes (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  queue_id integer REFERENCES moderation_queue(id),
  target_type text,
  target_id integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_strikes_user_idx ON user_strikes (user_id);
CREATE INDEX IF NOT EXISTS user_strikes_created_idx ON user_strikes (created_at);
