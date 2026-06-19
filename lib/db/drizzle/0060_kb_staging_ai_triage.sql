-- 0060_kb_staging_ai_triage.sql
-- Task: KB review dummy-proof with fully-auto AI triage.
--
-- Adds 8 AI triage columns to kb_staging_docs so the triage service can
-- persist GPT-5 scoring results and auto-action decisions directly on the
-- staging row. Also creates an immutable kb_triage_audit_log table so every
-- auto-approve, auto-reject, and undo is permanently recorded for operator
-- review and accountability.

-- AI triage columns on kb_staging_docs
ALTER TABLE kb_staging_docs
  ADD COLUMN IF NOT EXISTS ai_confidence_score REAL,
  ADD COLUMN IF NOT EXISTS ai_recommended_action TEXT,
  ADD COLUMN IF NOT EXISTS ai_suggested_category TEXT,
  ADD COLUMN IF NOT EXISTS ai_cleaned_title TEXT,
  ADD COLUMN IF NOT EXISTS ai_summary TEXT,
  ADD COLUMN IF NOT EXISTS auto_action TEXT,
  ADD COLUMN IF NOT EXISTS auto_action_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_action_confidence REAL;

-- Immutable audit trail for all auto-triage events
CREATE TABLE IF NOT EXISTS kb_triage_audit_log (
  id SERIAL PRIMARY KEY,
  staging_doc_id INTEGER NOT NULL REFERENCES kb_staging_docs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,       -- 'auto_approved' | 'auto_rejected' | 'needs_review' | 'undone'
  confidence_score REAL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ai_reasoning TEXT,
  doc_title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kb_triage_audit_doc_idx ON kb_triage_audit_log (staging_doc_id);
CREATE INDEX IF NOT EXISTS kb_triage_audit_created_idx ON kb_triage_audit_log (created_at DESC);
