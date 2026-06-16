---
name: Schema table REMOVAL needs an explicit post-merge DROP
description: Removing a Drizzle table from the schema does not drop it in prod; the drift gate won't fire. Add an idempotent DROP migration + post-merge psql call.
---

# Removing a table requires an explicit prod DROP

When you delete a table from `lib/db/src/schema/` (remove the schema file + its
`schema/index.ts` export), the column/table is gone from the schema but the
**table stays in every existing database**.

**Why:** `lib/db/src/live-schema-drift.test.ts` only asserts schema ⊆ DB (every
schema-declared table/column exists in the DB). It does NOT flag tables that
exist in the DB but not in the schema. `scripts/post-merge.sh` gates
`drizzle-kit push --force` on that drift test — so a pure REMOVAL leaves the
test green, push is skipped, and the dropped table lingers in prod forever.
(`drizzle-kit push` would drop it, but it never runs.)

**How to apply:**
1. Add an idempotent `lib/db/drizzle/NNNN_drop_*.sql` with
   `DROP TABLE IF EXISTS <t> CASCADE;` (drop FK-dependents before parents).
   `sync-dev-db.sh` auto-loops all `drizzle/*.sql` (via api-server vitest
   globalSetup + the drift-test globalSetup), so dev gets the drop automatically.
2. Add an explicit `psql ... -f <that file>` call inside the
   `if [ -n "$DATABASE_URL" ]` block in `scripts/post-merge.sh` (before the push
   gate) so PROD actually drops it. Do NOT rely on push-force — the gate won't
   trigger it for a removal.
3. Apply the .sql to the current dev DB by hand once to confirm and to make the
   drift test pass immediately.

Contrast: ADDITIVE columns (new col WITH default) need only the schema field +
dev ALTER; the gated push-force handles prod. See additive-column-no-migration.md.

Note: old already-applied companions (e.g. 0028, 0040 baseline) may still
CREATE/UPDATE the now-removed tables, producing tolerated warnings in
sync-dev-db before the new DROP runs. Net state is correct; sync-dev-db
continues past those warnings by design.
