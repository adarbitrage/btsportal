-- Task #1628: kickoff & partner call reminders (email + SMS).
-- One per-category SMS opt-in governs BOTH kickoff-call and
-- accountability-partner-call text reminders, mirroring coaching_sms_opt_in.
-- Idempotent: guarded ADD COLUMN, safe on a fresh or already-migrated DB.
-- Defaults to true so existing members keep getting the same reminder
-- coverage they'd expect from an always-on category, consistent with
-- coaching_sms_opt_in's default.

ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_call_sms_opt_in boolean NOT NULL DEFAULT true;
