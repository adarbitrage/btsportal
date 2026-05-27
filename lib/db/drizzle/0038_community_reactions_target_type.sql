-- Add target_type, target_id, type columns to community_reactions
ALTER TABLE community_reactions ADD COLUMN IF NOT EXISTS target_type text;
ALTER TABLE community_reactions ADD COLUMN IF NOT EXISTS target_id integer;
ALTER TABLE community_reactions ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'like';

-- Backfill target_type and target_id from existing post/comment data
UPDATE community_reactions SET target_type = 'post', target_id = post_id WHERE post_id IS NOT NULL AND target_type IS NULL;
UPDATE community_reactions SET target_type = 'comment', target_id = comment_id WHERE comment_id IS NOT NULL AND target_type IS NULL;

-- Set NOT NULL now that backfill is done (rows with neither post nor comment get cleaned up)
DELETE FROM community_reactions WHERE target_type IS NULL OR target_id IS NULL;

-- Make columns NOT NULL
ALTER TABLE community_reactions ALTER COLUMN target_type SET NOT NULL;
ALTER TABLE community_reactions ALTER COLUMN target_id SET NOT NULL;

-- Drop old unique indexes (may not exist on fresh DBs)
DROP INDEX IF EXISTS community_reactions_user_post_idx;
DROP INDEX IF EXISTS community_reactions_user_comment_idx;

-- Create the new canonical UNIQUE constraint
CREATE UNIQUE INDEX IF NOT EXISTS community_reactions_target_user_type_idx
  ON community_reactions (target_type, target_id, user_id, type);

-- Create helper index on user_id for reaction lookups
CREATE INDEX IF NOT EXISTS community_reactions_user_idx ON community_reactions (user_id);
