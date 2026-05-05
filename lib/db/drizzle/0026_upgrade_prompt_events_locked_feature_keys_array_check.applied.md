# 0026_upgrade_prompt_events_locked_feature_keys_array_check — verification

This file records the environments in which the
`upgrade_prompt_events_locked_feature_keys_is_array` CHECK constraint
has been attached, and the verification that proves it actually rejects
the original-bug shape.

The constraint is defined in two places:

- `lib/db/src/schema/upgrade-prompt-events.ts` — Drizzle `check()` on
  the `upgrade_prompt_events` table. `pnpm --filter db push` will attach
  it on any environment where `locked_feature_keys` is already clean.
- `lib/db/drizzle/0026_upgrade_prompt_events_locked_feature_keys_array_check.sql`
  — manual SQL companion. Wraps an idempotent string-scalar UPDATE plus
  an `IF NOT EXISTS`-guarded `ALTER TABLE ... ADD CONSTRAINT` in a single
  transaction.

## Dev DB — 2026-04-29

### Pre-existing state

`SELECT id, jsonb_typeof(locked_feature_keys) FROM upgrade_prompt_events`
returned zero rows on this dev DB (the seed does not generate any
upgrade-prompt analytics events), so there was no data to repair. The
`0026` UPDATE still ran cleanly (`UPDATE 0`), confirming the data-fix
half is a safe no-op when the table is empty.

### Constraint attached

Catalog verification:

```sql
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = '"upgrade_prompt_events"'::regclass
  AND conname = 'upgrade_prompt_events_locked_feature_keys_is_array';
-- conname                                            | def
-- upgrade_prompt_events_locked_feature_keys_is_array | CHECK ((jsonb_typeof(locked_feature_keys) = 'array'::text))
```

`pnpm --filter db push` was then run and reported "Changes applied" with
no further DDL emitted, confirming the schema declaration matches.

### Bad-shape inserts are rejected

Pinned by the regression test
`artifacts/api-server/src/__tests__/upgrade-prompt-events-locked-feature-keys-array-check.test.ts`
which asserts SQLSTATE 23514 + the expected `conname` for string-scalar,
number-scalar, and object-scalar INSERTs, plus an UPDATE that turns an
existing array into a string scalar; happy-path real-array and empty-array
INSERTs are accepted. All 7 tests pass against the dev DB.

## Production — 2026-05-04

### Pre-existing state

```sql
SELECT jsonb_typeof(locked_feature_keys) AS shape, count(*)
FROM upgrade_prompt_events
GROUP BY jsonb_typeof(locked_feature_keys);
-- shape | count
-- array |    49
```

All 49 production rows already held a real JSONB array, so there was
no data to repair. The catalog query confirmed
`upgrade_prompt_events_locked_feature_keys_is_array` was not yet
attached.

### Repair + constraint attached

`0026_upgrade_prompt_events_locked_feature_keys_array_check.sql` was
pasted into the production SQL console. The repair UPDATE reported
`UPDATE 0` and the `ADD CONSTRAINT` block ran cleanly. Catalog
verification:

```sql
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = '"upgrade_prompt_events"'::regclass
  AND conname = 'upgrade_prompt_events_locked_feature_keys_is_array';
-- conname                                            | def
-- upgrade_prompt_events_locked_feature_keys_is_array | CHECK ((jsonb_typeof(locked_feature_keys) = 'array'::text))
```

### Redeploy / schema-push no-op verification — pending

The schema declaration in `lib/db/src/schema/upgrade-prompt-events.ts`
already matches the attached constraint shape, so the next production
redeploy is expected to make `pnpm --filter db push` a clean no-op.
This step must be performed by an operator (task agents cannot publish)
— once the next production deploy completes, append the actual `db
push` output here as the final piece of evidence.
