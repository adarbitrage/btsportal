-- Add status column to community_posts (active|hidden|deleted)
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- Backfill: rows that were soft-deleted get status='deleted'
UPDATE community_posts SET status = 'deleted' WHERE is_deleted = true AND status = 'active';

-- Add media_urls column to community_posts
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS media_urls jsonb NOT NULL DEFAULT '[]';

-- Add index for status filtering on posts
CREATE INDEX IF NOT EXISTS community_posts_status_idx ON community_posts (status);

-- Add status column to community_comments (active|hidden|deleted)
ALTER TABLE community_comments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- Backfill: rows that were soft-deleted get status='deleted'
UPDATE community_comments SET status = 'deleted' WHERE is_deleted = true AND status = 'active';
