---
name: Vitest forks pool hangs in the agent bash env
description: How to actually run the DB-backed vitest suites from the agent shell
---

Running api-server / lib/db vitest directly from the bash tool hangs forever
after the globalSetup line prints — it never reaches the test bodies. The
cause is the configured `pool: "forks"` with `singleFork: true`; the worker
fork never makes progress in this sandbox (DB connectivity itself is fine —
psql and a fresh pg Pool both connect).

**How to apply:** append `--pool=threads --no-file-parallelism` to the
vitest invocation. With that, DB suites run in ~10s. Also set
`SKIP_DEV_DB_SYNC=1` once the schema is already synced (avoids the slow
sync-dev push step) and `NODE_ENV=development` for auth-cookie tests. The
lib/db drift suite needs `SYNC_MIGRATIONS_ONLY=1` (its own globalSetup).

Unrelated but co-occurring: a killed sync-dev run can leave a hung
drizzle-kit process holding a lock — `pkill -9 -f drizzle` first if a run
was interrupted mid-setup.
