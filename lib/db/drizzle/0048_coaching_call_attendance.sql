-- Per-member attendance / recording-view tracking for group coaching calls.
-- A row is created the first time a member registers for / joins the live call
-- (registered_at) or opens the recording (recording_viewed_at). One row per
-- member per call (unique call_id + user_id). This lets scheduled-comms target
-- session-feedback prompts at people who actually attended/watched, and send a
-- new "recording ready" notification to people who registered — instead of
-- fanning both out to everyone merely entitled to the call.
--
-- Idempotent companion to the drizzle schema (kept in parity for the drift
-- tests). Harmless no-op on a DB that already has the table.

CREATE TABLE IF NOT EXISTS "coaching_call_attendance" (
  "id" serial PRIMARY KEY NOT NULL,
  "call_id" integer NOT NULL REFERENCES "coaching_calls"("id"),
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "registered_at" timestamp with time zone,
  "recording_viewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "coaching_call_attendance_call_user_unq" UNIQUE ("call_id", "user_id")
);
