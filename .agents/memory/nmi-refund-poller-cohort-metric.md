---
name: NMI refund/chargeback poller + partnered-cohort metric
description: Read-only daily poller ingesting NMI refunds/chargebacks; cohort metric degrades gracefully with no partner-assignment table yet.
---

The NMI refund/chargeback poller is intentionally **read-only** against NMI
and never calls any charging/refund/dunning mutation — that's a hard scope
fence from the task that closed a real blind spot (reversals issued directly
in the gateway dashboard were previously invisible). Keep future extensions
additive/read-only.

Idempotency is achieved with a DB-level unique constraint plus an
insert-time conflict-skip, and a small time overlap is deliberately
re-polled every run (safe because of that constraint) — don't "fix" the
overlap as if it were a bug. Unmatched transactions are always recorded
(never silently dropped) and logged for visibility.

The partnered-cohort metric has no real partner-assignment data source yet,
so cohort resolution is a documented placeholder that returns an empty set
today — everything downstream (baseline comparison, monthly trend) must
degrade to "no data" rather than error when the cohort is empty. Only the
placeholder needs to change once real partner assignment exists.

**Why:** a self-mock of a module (mocking one export of a file to test how
another function *in the same file* behaves) does not work — internal
same-module function calls resolve directly, bypassing the mock. Split the
part you need to unit-test into its own pure function taking explicit
inputs, and mock only at true module boundaries.
