---
name: Pack admin sessions stats filter
description: The pack-coaching admin bookings endpoint stats must honour the same filters as the rows.
---

In `artifacts/api-server/src/routes/admin-coaching-sessions.ts`, `GET /admin/coaching/sessions`
returns `bookings` (rows), `total` (count), and `stats` (per-status counts). The rows and count
queries build a `where` (status, coachId, q→ilike on usersTable name/email, from/to date range)
and join `usersTable`.

**Rule:** the `stats` groupBy query MUST also `.innerJoin(usersTable, ...)` and `.where(where)`.
If it groups over the whole table, stats become global while the table is filtered — the admin
sees inconsistent numbers, and a `q` filter (which references usersTable) would otherwise error
without the join.

**Why:** caught in code review; original stats query had only `.groupBy(status)` with no filter.
**How to apply:** any future filter added to rows/count must be mirrored into the stats query.
Parity is guarded by `src/__tests__/admin-coaching-sessions-stats-filter.test.ts`
(run with `SKIP_DEV_DB_SYNC=1` once schema is synced; wrap in `timeout` — api-server vitest
keeps the process alive on teardown via open DB pool/timers).
