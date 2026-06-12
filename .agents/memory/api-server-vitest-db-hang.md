---
name: api-server vitest DB-test hang
description: Why DB-touching api-server vitest files hang and how to recover
---
The api-server vitest `globalSetup` runs `pnpm --filter @workspace/db sync-dev`
(companion SQL + `drizzle-kit push --force`). If a vitest run is killed while
that push is in flight, the push can hang holding a schema lock; afterwards any
DB-touching test file hangs indefinitely (collection finishes, first DB query
never returns), while non-DB tests still pass.

**Why:** `drizzle-kit push --force` against the known pre-existing drift takes a
heavy lock; an interrupted push leaves it stuck.

**How to apply:** once the dev schema is already synced, run individual files
with `SKIP_DEV_DB_SYNC=1` to bypass the slow/risky sync. If DB tests hang, kill
stray `drizzle-kit`/`vitest` procs, confirm `psql "$DATABASE_URL"` works, then
re-run. Use `timeout -k 5 N npx vitest run <file>` so a hung run self-terminates
instead of being killed by the tool (which is what causes the stuck-lock state).
