-- Transcript Cleaner holding store (Task #1468).
-- Raw transcripts land here, get AI-cleaned, sit in a holding area for admin
-- review + refinement, then are filed into ai_source_documents. Deliberately
-- separate from the curated kb_staging_docs pipeline (raw source, not citable).
-- New, additive table. Idempotent so it is safe to (re-)run via post-merge push
-- and on existing environments. Ships empty.
CREATE TABLE IF NOT EXISTS transcript_cleaner_documents (
  id serial PRIMARY KEY,
  title text NOT NULL DEFAULT '',
  suggested_title text,
  proposed_title text,
  title_needs_input boolean NOT NULL DEFAULT false,
  transcript_type text,
  original_content text NOT NULL,
  cleaned_content text,
  authority_role text,
  authority_confidence text,
  authority_evidence text,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  chat_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'uploaded',
  source_name text,
  provenance_note text,
  filed_source_doc_id integer,
  filed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transcript_cleaner_documents_status_idx
  ON transcript_cleaner_documents (status);
CREATE INDEX IF NOT EXISTS transcript_cleaner_documents_transcript_type_idx
  ON transcript_cleaner_documents (transcript_type);
