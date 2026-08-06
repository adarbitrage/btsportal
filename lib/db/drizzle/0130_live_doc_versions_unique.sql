-- Task #2098 hardening: one snapshot per (doc, version_number).
-- Backstop for the advisory-lock-serialized snapshot seam
-- (api-server src/lib/live-doc-snapshot.ts).
CREATE UNIQUE INDEX IF NOT EXISTS "ai_live_doc_versions_doc_version_uniq"
  ON "ai_live_document_versions" ("doc_id", "version_number");
