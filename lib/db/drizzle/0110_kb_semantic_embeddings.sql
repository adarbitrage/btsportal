-- Task #1803: hybrid semantic retrieval — pgvector embedding columns on the
-- citable live corpus + dual-score logging on the content-gap radar.
-- Additive-only and idempotent. The api-server boot hook
-- (runAiLiveDocumentEmbeddingColumnMigration) applies the same DDL as a
-- safety net for prod.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE ai_live_documents
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedding_generated_at timestamptz;

ALTER TABLE content_gap_questions
  ADD COLUMN IF NOT EXISTS top_semantic_score real NOT NULL DEFAULT 0;
