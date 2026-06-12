-- Session-pack 1-on-1 lifecycle: admin can finalize a booking outcome
-- (completed | no_show) with notes, and issue admin/no-show credit refunds.
-- Idempotent companion to the drizzle schema (kept in parity for the drift
-- tests).

ALTER TABLE "session_pack_bookings" ADD COLUMN IF NOT EXISTS "coach_notes" text;
ALTER TABLE "session_pack_bookings" ADD COLUMN IF NOT EXISTS "outcome_at" timestamptz;

-- At most one admin-issued refund (admin cancel / no-show return) per booking.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_coaching_credit_ledger_admin_refund"
  ON "coaching_credit_ledger" ("booking_id")
  WHERE reason in ('admin_cancel_refund', 'no_show_refund');
