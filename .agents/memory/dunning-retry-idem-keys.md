---
name: Dunning retry idempotency keys
description: Retry cadence, idempotency key pattern, and state transitions for the 6.2b past_due dunning state machine.
---

## Retry cadence
- Attempt #1 = original due-date decline → retry_count=1, next_retry_at = now+3d
- Attempt #2 = first retry (+3d) → idempotency key: `sub_{id}_period_{periodEnd}_retry_1`
  - On decline: retry_count=2, next_retry_at = now+4d (total +7d from original)
- Attempt #3 = second retry (+7d) → key: `sub_{id}_period_{periodEnd}_retry_2`
  - On decline: status=unpaid, revoke grant, send payment_failed_final email

## Key design rule
The `currentRetryCount` is the value **before** the charge (i.e., the retry slot number). A second run with the same current_period_end + same retry_count replays instead of double-charging.

**Why:** Using the pre-charge count means the key is stable across re-runs of the same tick without needing to store a separate "attempt number" column.

## Email policy
- Attempt #1 decline (Phase 1): send `payment_failed` email
- Attempt #2 decline (Phase 2a intermediate): NO email
- Attempt #3 decline (Phase 2a final): send `payment_failed_final` email
- Phase 2b cancel finalization: NO email

## vi.hoisted trap
Mock functions referenced in vi.mock factories must be declared with `vi.hoisted()`, not as plain `const`, or vitest's hoisting causes "Cannot access before initialization".
