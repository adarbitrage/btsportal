---
name: Session-credit ledger concurrency
description: How standalone 1-on-1 session-credit spend/refund stay race-safe (book + cancel paths).
---

The standalone credit-based 1-on-1 "session pack" booking feature (separate from
mentorship/entitlements) tracks credits as an append-only ledger
(`coaching_credit_ledger`, balance = SUM(delta)). Both the spend (book) and the
refund (cancel) paths MUST serialize per member and be idempotent.

**Rule:**
- Every credit mutation runs inside a transaction that first takes
  `pg_advisory_xact_lock` on the SAME per-member key (`member-credit:{userId}`
  hashed). Book and cancel share this key so they can't interleave.
- Cancel must be claimed atomically: `UPDATE ... SET status='cancelled' WHERE
  id=? AND member_id=? AND status='booked' RETURNING` — only the row-count===1
  winner does the GHL cancel + inserts the `+1` refund. Never re-check status
  with a separate SELECT before the update.
- GHL cancel happens INSIDE the cancel transaction; if GHL fails, ROLLBACK so the
  booking stays `booked` and no refund is recorded.
- Defense in depth: partial unique index
  `uq_coaching_credit_ledger_cancel_refund` on `(booking_id) WHERE reason =
  'cancel_refund'` guarantees at most one refund per booking even under retries.

**Why:** original cancel read status outside any lock, then cancelled GHL, then
inserted refund — two concurrent cancels of the same booking could both pass the
check and both refund (+2 credits). Book path was already lock-guarded; cancel
was not.

**How to apply:** any new credit-affecting action (purchase, admin adjustment,
no-show penalty) takes the same advisory lock and, if it touches a booking,
relies on a conditional status transition rather than read-then-write.
