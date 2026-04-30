# 0024_api_keys_permissions_array_check — verification

This file records the environments in which the
`api_keys_permissions_is_array` CHECK constraint has been attached, and
the verification that proves it actually rejects the original-bug shape.

The constraint is defined in two places:

- `lib/db/src/schema/api-keys.ts` — Drizzle `check()` on the `api_keys` table.
  `pnpm --filter db push` will attach it on any environment where
  `permissions` is already clean (every row a JSONB array).
- `lib/db/drizzle/0024_api_keys_permissions_array_check.sql` — manual
  SQL companion. Wraps an idempotent string-scalar UPDATE plus an
  `IF NOT EXISTS`-guarded `ALTER TABLE ... ADD CONSTRAINT` in a single
  transaction, so it can also be used as a one-shot fixer on an
  environment whose data has not been touched yet, and it stays a safe
  no-op if re-run after the schema sync has already attached the
  constraint.

## Dev DB — 2026-04-29

### Pre-existing state

`SELECT id, jsonb_typeof(permissions) FROM api_keys` returned zero rows on
this dev DB (the seed does not create any API keys), so there was no data
to repair. The `0024` UPDATE still ran cleanly (`UPDATE 0`), confirming
the data-fix half is a safe no-op when the table is empty or already clean.

### Constraint attached

`psql … -f lib/db/drizzle/0024_api_keys_permissions_array_check.sql`
attached the constraint cleanly. Catalog verification:

```sql
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = '"api_keys"'::regclass
  AND conname = 'api_keys_permissions_is_array';
-- conname                       | def
-- api_keys_permissions_is_array | CHECK ((jsonb_typeof(permissions) = 'array'::text))
```

`pnpm --filter db push` was then run and reported "Changes applied" with
no further DDL emitted, confirming the schema declaration matches the
attached constraint exactly (no drift).

### Bad-shape inserts are rejected

Pinned by the regression test
`artifacts/api-server/src/__tests__/api-keys-permissions-array-check.test.ts`
which asserts SQLSTATE 23514 + the expected `conname` for:

- string-scalar INSERT (the original `JSON.stringify(JSON.stringify([…]))` shape)
- number-scalar INSERT
- object INSERT
- UPDATE that turns an existing array into a string scalar

…and accepts a real array INSERT and an empty-array INSERT as the happy
path. All 7 tests pass against the dev DB.

## Production

Pending. Recommended sequence:

1. Apply `0024_api_keys_permissions_array_check.sql` against the production
   DB via the SQL console. The script is idempotent and safe to re-run.
2. Deploy the schema change so `pnpm --filter db push` sees the constraint
   already in place and treats it as a no-op.
3. Append a verification block here with the date and the catalog evidence.
