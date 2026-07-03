---
name: Fleet-wide alerter tests need real-fixture isolation
description: How to test scheduled evaluators that scan an entire table with no per-row scoping (no-show/vanish/capacity style), when the dev DB already has permanent seeded rows of that same kind.
---

Some scheduled evaluators are intentionally unscoped — they scan an entire
table fleet-wide rather than filtering to one caller's rows (e.g. "any
partner with 3 consecutive no-shows", "trailing-7-day booked/available ratio
across all active partners"). This is correct production behavior, but it
means:

1. **Cross-test pollution within the same file**: if fixtures are only
   cleaned up in a single `afterAll`, an earlier test's rows are still
   present (and still "escalating"/"vanished") when a later test's unscoped
   scan runs, inflating counts. Fix: clean up each test's fixtures in
   `afterEach`, not just once at the end.

2. **Pollution from permanent seeded data**: the dev DB already has
   real, non-test rows of the same kind (e.g. a handful of real active
   partners seeded via the coach-roster/partner-roster boot seed). An
   unscoped table-wide test will always include them, making exact-number
   assertions (available slots, ratios) non-deterministic across
   environments. Fix: in a `beforeAll`/`afterAll` scoped to the relevant
   `describe` block, snapshot and temporarily flip the pre-existing rows to
   an inactive/excluded state for the duration of the block, then restore
   them exactly as found — never delete real seeded rows.

**Why:** an unscoped/fleet-wide evaluator has no per-row key an assertion can
filter on, so any leftover row — whether from an earlier test or from
permanent seed data — silently shifts its aggregate result (count, ratio).
Evaluators that scan a specific caller's rows (filterable by an id) only
need the per-test cleanup; only truly global aggregates need the
seed-data-neutralization step too.

**How to apply:** any new fleet-wide/global scheduled-evaluator test should
default to per-test cleanup, and should explicitly check (via a query) for
pre-existing real rows of the same shape before assuming a clean slate.
