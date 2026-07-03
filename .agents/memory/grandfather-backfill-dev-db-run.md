---
name: One-time marker-claim backfills executed for real during dev testing
description: Integration-testing a marker-claim (run-exactly-once) backfill against a shared dev DB actually executes it permanently — design tests and expectations accordingly.
---

Some backfills are true one-time, marker-claim migrations (same pattern as
the onboarding step-contract migrations): a system-settings row is claimed
exactly once inside the same transaction as the bulk write, and once claimed
the function refuses to run again — ever, in that database. Writing an
integration test that calls the execute path with confirmation against the
shared dev DB does not "simulate" execution — it **actually claims the
marker for good**. Any row created by a later test run is a legitimate
"post-cutoff" case and must assert the opposite outcome from a pre-cutoff
row.

**Why:** the first real test run in this dev DB actually executed and
permanently marked the pre-existing rows. A test written assuming "this
might be the first run OR a repeat run" must branch on the migration's own
pre-flight/already-run signal *read before seeding*, and assert the opposite
outcome depending on which branch it's in — both branches are real, valid
demonstrations of the cutoff guarantee.

**How to apply:** for any one-time/marker-claim backfill test in this repo,
check pre-flight state before seeding, and write both branches of the
idempotency assertion rather than assuming a clean marker state. Also scope
any bulk read/write in such a backfill to the exact population it's meant
for (e.g. a `role` predicate alongside a `migrated` predicate) — a broader
predicate silently pulls in rows (admins, service accounts, etc.) that were
never the intended subject.

## Read-after-write lag on the dev DB proxy

Immediately after a `db.transaction()` commits an UPDATE, a subsequent
`db.select()` on a **different pooled connection** can occasionally return
the pre-write value for a beat. This is not a bug in the transaction itself
(the transaction's own `.returning()` count is authoritative for what it
touched).

**How to apply:** when a test asserts on a row immediately after a write
made via `db.transaction()`, poll with a short retry loop (e.g. ~100ms
interval, a few seconds ceiling) instead of asserting on a single read.
