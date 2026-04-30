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

## Production

Pending. Recommended sequence:

1. Apply `0028_coaching_sessions_action_items_array_check.sql` against
   the production DB via the SQL console. The script is idempotent.
2. Deploy the schema change so `pnpm --filter db push` sees the constraint
   already in place.
3. Append a verification block here with the date and the catalog evidence.
