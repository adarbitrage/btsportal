ALTER TABLE "kb_staging_docs"
  ADD COLUMN IF NOT EXISTS "processing_stage" text,
  ADD COLUMN IF NOT EXISTS "processing_error" text;
