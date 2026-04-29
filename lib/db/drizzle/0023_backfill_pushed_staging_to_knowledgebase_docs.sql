-- One-shot backfill for prod: copies kb_staging_docs rows that are
-- status='pushed' (sources: blitz, coaching_call) into knowledgebase_docs.
--
-- Re-runnable. Uses ON CONFLICT (title) DO UPDATE so existing rows are
-- refreshed with the latest staging content.
--
-- Run this AFTER 0023's unique index `knowledgebase_docs_title_uniq` is in
-- place (it is created by the Drizzle schema push of this PR).
--
-- Apply via the Replit Database pane (production environment).

BEGIN;

INSERT INTO knowledgebase_docs (title, category, content)
SELECT
  s.title,
  s.category,
  COALESCE(s.edited_content, s.content) AS content
FROM kb_staging_docs s
WHERE s.status = 'pushed'
  AND s.source IN ('blitz', 'coaching_call')
ON CONFLICT (title) DO UPDATE
  SET category   = EXCLUDED.category,
      content    = EXCLUDED.content,
      updated_at = NOW();

-- Verification (run these after the INSERT to sanity-check)
SELECT COUNT(*) AS total_live_kb_rows FROM knowledgebase_docs;
SELECT COUNT(*) AS blitz_or_coaching_pushed_in_staging
FROM kb_staging_docs
WHERE status = 'pushed' AND source IN ('blitz', 'coaching_call');
SELECT category, COUNT(*) AS n FROM knowledgebase_docs GROUP BY category ORDER BY n DESC;

COMMIT;
