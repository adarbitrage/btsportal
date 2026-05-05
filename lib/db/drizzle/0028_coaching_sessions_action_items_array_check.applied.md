# 0028_coaching_sessions_action_items_array_check — verification

This file records the environments in which the
`coaching_sessions_action_items_is_array` CHECK constraint has been
attached, and the verification that proves it actually rejects the
original-bug shape.

The constraint is defined in two places:

- `lib/db/src/schema/coaching-sessions.ts` — Drizzle `check()` on the
  `coaching_sessions` table.
- `lib/db/drizzle/0028_coaching_sessions_action_items_array_check.sql`
  — manual SQL companion. Wraps an idempotent string-scalar UPDATE plus
  an `IF NOT EXISTS`-guarded `ALTER TABLE ... ADD CONSTRAINT` in a single
  transaction.

## Dev DB — 2026-04-29

### Pre-existing state

`SELECT id, jsonb_typeof(action_items) FROM coaching_sessions` returned
zero rows on this dev DB (the seed does not generate any coaching
sessions), so there was no data to repair. The `0028` UPDATE still ran
cleanly (`UPDATE 0`), confirming the data-fix half is a safe no-op when
the table is empty.

### Constraint attached

```sql
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = '"coaching_sessions"'::regclass
  AND conname = 'coaching_sessions_action_items_is_array';
-- conname                                 | def
-- coaching_sessions_action_items_is_array | CHECK (((action_items IS NULL) OR (jsonb_typeof(action_items) = 'array'::text)))
```

The constraint accepts NULL because `action_items` is a nullable column.

`pnpm --filter db push` was then run and reported "Changes applied" with
no further DDL emitted, confirming the schema declaration matches.

### Bad-shape inserts are rejected

Pinned by the regression test
`artifacts/api-server/src/__tests__/coaching-sessions-action-items-array-check.test.ts`,
which spins up its own member user + coach fixture rows so the
INSERT/UPDATE statements satisfy the FK constraints, then asserts
SQLSTATE 23514 + the expected `conname` for string-scalar,
number-scalar, and object-scalar INSERTs, plus an UPDATE that turns an
existing array into a string scalar; happy-path real-array, empty-array,
and explicit-NULL INSERTs are accepted. All 8 tests pass against the
dev DB.

## Production — 2026-05-04

### Pre-existing state

```sql
SELECT jsonb_typeof(action_items) AS shape, count(*)
FROM coaching_sessions
GROUP BY jsonb_typeof(action_items);
-- shape | count
-- array |     7
```

All 7 production rows already held a real JSONB array, so there was no
data to repair. The catalog query confirmed
`coaching_sessions_action_items_is_array` was not yet attached.

### Repair + constraint attached

`0028_coaching_sessions_action_items_array_check.sql` was pasted into
the production SQL console. The repair UPDATE reported `UPDATE 0` and
the `ADD CONSTRAINT` block ran cleanly. Catalog verification:

```sql
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = '"coaching_sessions"'::regclass
  AND conname = 'coaching_sessions_action_items_is_array';
-- conname                                 | def
-- coaching_sessions_action_items_is_array | CHECK (((action_items IS NULL) OR (jsonb_typeof(action_items) = 'array'::text)))
```

The constraint accepts NULL because `action_items` is a nullable
column.

### Redeploy / schema-push no-op verification — pending

The schema declaration in `lib/db/src/schema/coaching-sessions.ts`
already matches the attached constraint shape, so the next production
redeploy is expected to make `pnpm --filter db push` a clean no-op.
This step must be performed by an operator (task agents cannot publish)
— once the next production deploy completes, append the actual `db
push` output here as the final piece of evidence.
