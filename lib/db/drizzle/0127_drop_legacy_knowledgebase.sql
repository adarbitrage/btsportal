-- Task #2029: retire the legacy knowledge base stack.
-- Idempotent: safe to re-run. Bookmarks first (FK onto docs).
DROP TABLE IF EXISTS knowledgebase_bookmarks;
DROP TABLE IF EXISTS knowledgebase_docs;
