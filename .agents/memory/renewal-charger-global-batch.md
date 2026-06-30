---
name: NMI renewal charger — global batch + per-period idempotency
description: How processDueRenewals selects work and stays double-run safe; the testing constraints that fall out of both.
---

# processDueRenewals is a GLOBAL batch processor

`processDueRenewals({ now?, maxPerRun? })` selects EVERY due subscription in the DB
(active, not cancel_at_period_end, next_charge_at <= now), ordered oldest-due first.
It is not scoped to a user/product.

**Testing implication:** any test that asserts on the returned counts
(`processed`/`succeeded`/`declined`) must first neutralize every *other* due sub or
the counts inflate. Drain globally in `beforeEach` (push all subs'
`next_charge_at` far into the future), not just the current test user's rows —
**orphan subscriptions from a crashed prior run persist in the shared test DB under
old random user ids** and will be picked up otherwise.

# Double-run safety is two layers, and tests must isolate the key

1. On success the period advances, moving `next_charge_at` out of the due window —
   so a normal second tick simply finds nothing due.
2. The deterministic per-period idempotency key `sub_{subscriptionId}_period_{current_period_end ISO}`
   makes a re-run REPLAY the first result (replay_paid) instead of re-charging:
   no gateway call, no `onOrderPaid`, no new order.

**Why it matters:** to actually exercise layer 2 (not just layer 1), a test must
revert the sub to its pre-advance state (SAME `current_period_end`, so the SAME key)
between the two runs. After advance the key would differ (new period end) and a
charge would correctly happen again — that is a new period, not a double charge.

# Cleanup FK order

`checkout_idempotency.order_id → bts_orders.id` and `bts_orders.subscription_id →
subscriptions.id`. Tear down in that order: idempotency rows first, then orders,
then subscriptions. Deleting orders first throws 23503.
