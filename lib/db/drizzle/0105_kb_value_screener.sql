-- Task #1702: coaching-transcript VALUE SCREENER durable store.
-- Three new, additive, empty tables that sit between the existing source
-- screening/mining gates and the synthesis engine. Nothing member-facing.
-- Written idempotently (CREATE TABLE/INDEX IF NOT EXISTS) so applying it here
-- (post-merge) keeps the live-schema-drift gate green and a re-run is a no-op.

-- Per-source screening run record (dedup verdict + cache-invalidation stamps).
CREATE TABLE IF NOT EXISTS kb_call_screenings (
  id                     serial PRIMARY KEY,
  source_doc_id          integer NOT NULL REFERENCES ai_source_documents(id) ON DELETE CASCADE,
  content_fingerprint    text NOT NULL,
  calibration_version    text NOT NULL,
  dedup_status           text NOT NULL DEFAULT 'unique',
  normalized_hash        text NOT NULL,
  duplicate_of_source_id integer,
  similarity_score       integer,
  exchange_count         integer NOT NULL DEFAULT 0,
  kept_count             integer NOT NULL DEFAULT 0,
  dropped_count          integer NOT NULL DEFAULT 0,
  flagged_count          integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kb_call_screenings_source_unq ON kb_call_screenings (source_doc_id);
CREATE INDEX IF NOT EXISTS kb_call_screenings_dedup_idx ON kb_call_screenings (dedup_status);

-- Per-exchange screened-output store (kept AND dropped units, with reasons).
CREATE TABLE IF NOT EXISTS kb_screened_exchanges (
  id                    serial PRIMARY KEY,
  screening_id          integer NOT NULL REFERENCES kb_call_screenings(id) ON DELETE CASCADE,
  source_doc_id         integer NOT NULL REFERENCES ai_source_documents(id) ON DELETE CASCADE,
  order_index           integer NOT NULL,
  member_prompt         text NOT NULL DEFAULT '',
  coach_response        text NOT NULL DEFAULT '',
  value_type            text NOT NULL DEFAULT 'unclassified',
  disposition           text NOT NULL DEFAULT 'flag',
  drop_reason           text,
  situational_number    boolean NOT NULL DEFAULT false,
  rationale             text,
  override_disposition  text,
  override_by           integer,
  override_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_screened_exchanges_screening_idx ON kb_screened_exchanges (screening_id);
CREATE INDEX IF NOT EXISTS kb_screened_exchanges_source_idx ON kb_screened_exchanges (source_doc_id);
CREATE INDEX IF NOT EXISTS kb_screened_exchanges_disposition_idx ON kb_screened_exchanges (disposition);

-- Versioned coach-calibration exemplar set (gold/noise few-shot examples).
CREATE TABLE IF NOT EXISTS kb_calibration_examples (
  id                serial PRIMARY KEY,
  member_prompt     text NOT NULL DEFAULT '',
  coach_response    text NOT NULL DEFAULT '',
  label             text NOT NULL,
  value_type        text,
  note              text,
  source_exchange_id integer,
  created_by        integer,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_calibration_examples_label_idx ON kb_calibration_examples (label);
CREATE INDEX IF NOT EXISTS kb_calibration_examples_active_idx ON kb_calibration_examples (active);
