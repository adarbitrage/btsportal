---
name: migration-drift baseline fixture
description: Adding a plain new table via schema-only fails db-drift until the recorded baseline fixture is refreshed.
---

Adding a brand-new table by declaring it ONLY in `lib/db/src/schema/*.ts` (no SQL
migration file) makes the `db-drift` workflow fail on `src/migration-drift.test.ts`.
The table's PK/FK/UNIQUE constraints and its indexes appear as new `onlyInPush`
entries (schema declares them, no raw SQL migration produces them).

**Fix:** review the diff, then refresh the recorded baseline:
`UPDATE_DRIFT_BASELINE=1 pnpm --filter @workspace/db test`
(or scope it: `... exec vitest run src/migration-drift.test.ts`). This rewrites
`lib/db/src/__fixtures__/expected-drift.json`. Re-run without the flag to confirm.

**Why:** push (`drizzle-kit push --force`) is the deploy mechanism here, so
schema-declared constraints with no SQL migration are expected/normal — `onlyInPush`
is the benign class. The baseline exists to catch the *other* class (`onlyInMigrations`
= a SQL migration adds a constraint the schema forgot, the task #488 failure class).

**How to apply:** `db-drift` runs TWO independent tests — `live-schema-drift.test.ts`
(schema ⊆ live DB) and `migration-drift.test.ts` (push-vs-SQL baseline). Passing the
first does NOT imply the second; always run the whole `db-drift` suite after any
schema change, not just live-schema-drift.

**Companion-.sql tables produce NO baseline entry:** when you add a new table WITH a
committed idempotent `CREATE TABLE IF NOT EXISTS` companion in `lib/db/drizzle/` (the
correct additive-table pattern), it appears in BOTH the push DB and the migrate DB, so
there is zero drift — `expected-drift.json` does NOT gain your table name and the diff
stays unchanged. Don't expect to see the new table in the baseline; a clean (unchanged)
baseline + passing drift tests IS the success signal. Only schema-only tables (no .sql)
show up as `onlyInPush`.

**Vitest hangs from bash here** unless you pass `--pool=threads --no-file-parallelism`;
regenerate with `UPDATE_DRIFT_BASELINE=1 pnpm --filter @workspace/db exec vitest run
src/migration-drift.test.ts --pool=threads --no-file-parallelism` (the env var is
`UPDATE_DRIFT_BASELINE=1`, not `l=1`).
