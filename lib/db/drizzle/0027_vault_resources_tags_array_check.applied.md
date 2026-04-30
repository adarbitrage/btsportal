# 0027_vault_resources_tags_array_check — verification

This file records the environments in which the
`vault_resources_tags_is_array` CHECK constraint has been attached, and
the verification that proves it actually rejects the original-bug shape.

This is the only one of the Task #412 columns that had real bad data
sitting in the dev DB at the time of the migration: 25 rows whose
`tags` column was a JSONB string scalar, not an array, because
`artifacts/api-server/src/lib/seed-vault.ts` was building its seed rows
with `tags: JSON.stringify([...])`. That seed bug was fixed in the same
task; this migration repairs the rows the seed had already written.

The constraint is defined in two places:

- `lib/db/src/schema/vault-resources.ts` — Drizzle `check()` on the
  `vault_resources` table.
- `lib/db/drizzle/0027_vault_resources_tags_array_check.sql` — manual
  SQL companion. Wraps an idempotent string-scalar UPDATE
  (`UPDATE vault_resources SET tags = tags::text::jsonb WHERE jsonb_typeof(tags) = 'string'`)
  plus an `IF NOT EXISTS`-guarded `ALTER TABLE ... ADD CONSTRAINT` in a
  single transaction. The repair is safe to re-run because rows that
  already hold an array are skipped by the `WHERE` clause.

## Dev DB — 2026-04-29

### Pre-existing state

```sql
SELECT jsonb_typeof(tags) AS shape, count(*)
FROM vault_resources
GROUP BY jsonb_typeof(tags);
-- shape  | count
-- string |    25
-- array  |    (other seeded rows, if any)
```

All 25 string-scalar rows came from the seeded vault catalogue, where
`tags: JSON.stringify(["something"])` produced a JSONB *string* whose
value happened to be the JSON encoding of an array. Any code path
iterating `tags` saw a string and silently produced an empty/garbled
result.

### Repair

The data-fix UPDATE inside `0027_vault_resources_tags_array_check.sql`
ran first and reported `UPDATE 25`. After it:

```sql
SELECT jsonb_typeof(tags) AS shape, count(*)
FROM vault_resources
GROUP BY jsonb_typeof(tags);
-- shape | count
-- array | 25 + (other seeded rows)
-- null  | (rows where tags was already NULL)
```

No string-scalar rows remained, so the subsequent `ADD CONSTRAINT`
succeeded.

### Constraint attached

```sql
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = '"vault_resources"'::regclass
  AND conname = 'vault_resources_tags_is_array';
-- conname                       | def
-- vault_resources_tags_is_array | CHECK (((tags IS NULL) OR (jsonb_typeof(tags) = 'array'::text)))
```

The constraint accepts NULL because `tags` is a nullable column.

`pnpm --filter db push` was then run and reported "Changes applied" with
no further DDL emitted, confirming the schema declaration matches.

### Bad-shape inserts are rejected

Pinned by the regression test
`artifacts/api-server/src/__tests__/vault-resources-tags-array-check.test.ts`
which asserts SQLSTATE 23514 + the expected `conname` for string-scalar,
number-scalar, and object-scalar INSERTs, plus an UPDATE that turns an
existing array into a string scalar; happy-path real-array, empty-array,
and explicit-NULL INSERTs are accepted. All 8 tests pass against the
dev DB.

## Production

Pending. Recommended sequence:

1. **Run a sanity query first** — production may also have been seeded
   with the buggy `seed-vault.ts`, so before applying anything, run:

   ```sql
   SELECT jsonb_typeof(tags) AS shape, count(*)
   FROM vault_resources
   GROUP BY jsonb_typeof(tags);
   ```

   If the `string` row count is non-zero, the migration's UPDATE will
   repair them; capture the count for the verification block below.
2. Apply `0027_vault_resources_tags_array_check.sql` against the
   production DB via the SQL console. The script is idempotent.
3. Deploy the schema change so `pnpm --filter db push` sees the constraint
   already in place.
4. Append a verification block here with the date, the repair count,
   and the catalog evidence.
