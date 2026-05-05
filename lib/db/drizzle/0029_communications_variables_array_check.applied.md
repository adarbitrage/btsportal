# 0029_communications_variables_array_check — verification

This file records the environments in which the three
`*_variables_is_array` CHECK constraints (one each on `email_templates`,
`email_template_versions`, `sms_templates`) have been attached, and the
verification that proves they actually reject the original-bug shape.

The constraints are defined in two places:

- `lib/db/src/schema/communications.ts` — Drizzle `check()` on each of
  the three template tables.
- `lib/db/drizzle/0029_communications_variables_array_check.sql` —
  manual SQL companion. Wraps three idempotent string-scalar UPDATEs
  plus three `IF NOT EXISTS`-guarded `ALTER TABLE ... ADD CONSTRAINT`
  statements in a single transaction.

## Dev DB — 2026-04-29

### Pre-existing state

```sql
SELECT 'email_templates' AS tbl, jsonb_typeof(variables) AS shape, count(*)
FROM email_templates GROUP BY shape
UNION ALL
SELECT 'email_template_versions', jsonb_typeof(variables), count(*)
FROM email_template_versions GROUP BY jsonb_typeof(variables)
UNION ALL
SELECT 'sms_templates', jsonb_typeof(variables), count(*)
FROM sms_templates GROUP BY jsonb_typeof(variables);
```

No string-scalar rows existed in the dev DB across any of the three
tables — the seeded templates already wrote real JSONB arrays. The
three repair UPDATEs in `0029` ran cleanly (`UPDATE 0` each), confirming
the data-fix half is a safe no-op when the data is already clean.

### Constraints attached

```sql
SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conname IN (
  'email_templates_variables_is_array',
  'email_template_versions_variables_is_array',
  'sms_templates_variables_is_array'
)
ORDER BY conname;
-- email_template_versions | email_template_versions_variables_is_array | CHECK (((variables IS NULL) OR (jsonb_typeof(variables) = 'array'::text)))
-- email_templates         | email_templates_variables_is_array         | CHECK (((variables IS NULL) OR (jsonb_typeof(variables) = 'array'::text)))
-- sms_templates           | sms_templates_variables_is_array           | CHECK (((variables IS NULL) OR (jsonb_typeof(variables) = 'array'::text)))
```

All three constraints accept NULL because `variables` is a nullable
column on every one of the three tables.

`pnpm --filter db push` was then run and reported "Changes applied" with
no further DDL emitted, confirming the schema declarations match.

### Bad-shape inserts are rejected

Pinned by the regression test
`artifacts/api-server/src/__tests__/communications-variables-array-check.test.ts`,
which seeds a parent `email_templates` row to satisfy the
`email_template_versions.template_id` FK and then asserts SQLSTATE 23514
+ the expected `conname` for string-scalar / object / update-to-string
writes against each of the three tables; happy-path real-array and
explicit-NULL writes are accepted. All 13 tests pass against the dev DB.

## Production — 2026-05-04

### Pre-existing state

The pre-application sanity query against the three template tables
showed every row already held a real JSONB array — none of the
`JSON.stringify` regression shape that broke `vault_resources.tags`
had reached the communications schema:

```sql
SELECT jsonb_typeof(variables) AS shape, count(*)
FROM email_templates GROUP BY jsonb_typeof(variables);
-- shape | count
-- array |    36

SELECT jsonb_typeof(variables) AS shape, count(*)
FROM email_template_versions GROUP BY jsonb_typeof(variables);
-- shape | count
-- array |     2

SELECT jsonb_typeof(variables) AS shape, count(*)
FROM sms_templates GROUP BY jsonb_typeof(variables);
-- shape | count
-- array |     7
```

The catalog query confirmed none of the three
`*_variables_is_array` constraints were yet attached.

### Repair + constraints attached

`0029_communications_variables_array_check.sql` was pasted into the
production SQL console. The three repair UPDATEs each reported
`UPDATE 0` (consistent with the pre-state above) and all three
`ADD CONSTRAINT` blocks ran cleanly. Catalog verification:

```sql
SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conname IN (
  'email_templates_variables_is_array',
  'email_template_versions_variables_is_array',
  'sms_templates_variables_is_array'
)
ORDER BY conname;
-- email_template_versions | email_template_versions_variables_is_array | CHECK (((variables IS NULL) OR (jsonb_typeof(variables) = 'array'::text)))
-- email_templates         | email_templates_variables_is_array         | CHECK (((variables IS NULL) OR (jsonb_typeof(variables) = 'array'::text)))
-- sms_templates           | sms_templates_variables_is_array           | CHECK (((variables IS NULL) OR (jsonb_typeof(variables) = 'array'::text)))
```

All three constraints accept NULL because `variables` is nullable on
each table.

### Redeploy / schema-push no-op verification — pending

The schema declarations in `lib/db/src/schema/communications.ts`
already match the attached constraint shapes, so the next production
redeploy is expected to make `pnpm --filter db push` a clean no-op.
This step must be performed by an operator (task agents cannot publish)
— once the next production deploy completes, append the actual `db
push` output here as the final piece of evidence.
