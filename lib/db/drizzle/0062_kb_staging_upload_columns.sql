ALTER TABLE "kb_staging_docs"
  ADD COLUMN IF NOT EXISTS "audience" text NOT NULL DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS "source_object_path" text;
