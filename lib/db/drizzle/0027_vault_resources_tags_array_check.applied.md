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

## Production — 2026-05-04

### Pre-existing state

The pre-application sanity query confirmed production had been seeded
with the same buggy `seed-vault.ts` as dev:

```sql
SELECT jsonb_typeof(tags) AS shape, count(*)
FROM vault_resources
GROUP BY jsonb_typeof(tags);
-- shape  | count
-- string |    25
```

All 25 production `vault_resources` rows held a JSONB *string scalar*
whose value happened to be the JSON encoding of an array, exactly the
same shape that broke dev. A spot-check of the first five rows showed
values like `"[\"facebook\",\"ads\",\"copy\",\"template\"]"` (a string
that looks like a JSON array) rather than a real JSONB array. The
catalog query confirmed `vault_resources_tags_is_array` was not yet
attached.

### Repair + constraint attached

`0027_vault_resources_tags_array_check.sql` was pasted into the
production SQL console. The repair UPDATE reported `UPDATE 25` —
matching the dev DB outcome exactly — and the `ADD CONSTRAINT` block
then ran cleanly because no string-scalar rows remained. Catalog
verification:

```sql
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = '"vault_resources"'::regclass
  AND conname = 'vault_resources_tags_is_array';
-- conname                       | def
-- vault_resources_tags_is_array | CHECK (((tags IS NULL) OR (jsonb_typeof(tags) = 'array'::text)))
```

The 25 previously-broken rows now serve real arrays to the admin
tag-listing endpoint and vault search UI.

### Redeploy / schema-push no-op verification — pending

The schema declaration in `lib/db/src/schema/vault-resources.ts`
already matches the attached constraint shape, so the next production
redeploy is expected to make `pnpm --filter db push` a clean no-op.
This step must be performed by an operator (task agents cannot publish)
— once the next production deploy completes, append the actual `db
push` output here as the final piece of evidence.
