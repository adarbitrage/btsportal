-- 0050_voice_calls.sql
-- Add voice_calls and voice_daily_usage tables for the Retell voice assistant feature.

CREATE TABLE IF NOT EXISTS voice_calls (
  id             serial PRIMARY KEY,
  user_id        integer NOT NULL REFERENCES users(id),
  retell_call_id text    NOT NULL UNIQUE,
  status         text    NOT NULL DEFAULT 'registered',
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  duration_seconds integer,
  transcript     text,
  summary        text,
  disconnect_reason text,
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS voice_daily_usage (
  id           serial PRIMARY KEY,
  user_id      integer NOT NULL REFERENCES users(id),
  usage_date   date    NOT NULL,
  seconds_used integer NOT NULL DEFAULT 0,
  CONSTRAINT voice_daily_usage_user_date_unique UNIQUE (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS voice_daily_usage_user_date_idx ON voice_daily_usage (user_id, usage_date);
