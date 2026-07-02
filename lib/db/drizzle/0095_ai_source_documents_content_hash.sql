-- Blitz change-monitoring foundation (Task #1564): additive, nullable
-- fingerprint columns on ai_source_documents that let the DORMANT
-- "Scan for changes" flow detect when a core-training source's content
-- changed (new sha256 != stored content_hash) and propose an
-- AI-reference-doc revision through the existing supersede path.
--
--   - content_hash    : sha256 hex of `content` at the last scan (NULL = never scanned).
--   - last_scanned_at : when the change scan last examined this row (NULL = never).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS), so re-runs / fresh DBs are no-ops.
ALTER TABLE ai_source_documents
  ADD COLUMN IF NOT EXISTS content_hash text;

ALTER TABLE ai_source_documents
  ADD COLUMN IF NOT EXISTS last_scanned_at timestamptz;

-- One-time backfill of the fingerprint for existing rows so the FIRST scan
-- only flags sources whose content genuinely changed (instead of treating
-- every never-hashed row as "changed"). pgcrypto's digest() over the UTF-8
-- text bytes matches Node's createHash("sha256").update(content,"utf8") used
-- by fingerprintContent, so hashes computed here and in the app agree.
-- Gated on content_hash IS NULL so it is idempotent and never re-writes a
-- hash the scan has already refreshed.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE ai_source_documents
   SET content_hash = encode(digest(content, 'sha256'), 'hex')
 WHERE content_hash IS NULL;
