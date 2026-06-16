-- Pack 1-on-1 coach/admin action items: structured per-session to-dos that
-- coaches and admins author and track. COACH/ADMIN-FACING ONLY (never returned
-- to members). Stored as JSONB on the booking so a member's full cross-coach
-- history is a simple member-id join. Idempotent companion to the drizzle
-- schema (kept in parity for the drift tests).

ALTER TABLE "session_pack_bookings"
  ADD COLUMN IF NOT EXISTS "action_items" jsonb NOT NULL DEFAULT '[]'::jsonb;
