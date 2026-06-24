-- Voice phone-call support: new columns + nullable user_id.
--
-- Adds `call_type` (web | phone_call) and `caller_phone` to voice_calls
-- so inbound toll-free calls are distinguishable from browser sessions and
-- the caller's number is recorded for member look-up and ticket context.
--
-- Makes `voice_calls.user_id` and `tickets.user_id` nullable so that calls
-- from unrecognised phone numbers and anonymous voice escalations can be
-- persisted without a matched member row.
--
-- All statements are idempotent (IF NOT EXISTS / DROP NOT NULL is a no-op
-- when the constraint is already absent) so this file replays safely on
-- top of a database that drizzle-kit push or a prior ALTER already updated.

ALTER TABLE voice_calls
  ADD COLUMN IF NOT EXISTS call_type text NOT NULL DEFAULT 'web';

ALTER TABLE voice_calls
  ADD COLUMN IF NOT EXISTS caller_phone text;

-- DROP NOT NULL is a no-op if the column is already nullable.
ALTER TABLE voice_calls
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE tickets
  ALTER COLUMN user_id DROP NOT NULL;
