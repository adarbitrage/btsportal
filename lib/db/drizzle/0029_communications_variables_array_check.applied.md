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

## Production

Pending. Recommended sequence:

1. **Run a sanity query first** — historically the same `JSON.stringify`
   pattern that broke `vault_resources.tags` was used in template
   admin tooling, so before applying anything, run the diagnostic query
   above against production. If any `string` rows exist, the migration's
   UPDATEs will repair them; capture the counts for the verification
   block below.
2. Apply `0029_communications_variables_array_check.sql` against the
   production DB via the SQL console. The script is idempotent.
3. Deploy the schema change so `pnpm --filter db push` sees the
   constraints already in place.
4. Append a verification block here with the date, any repair counts,
   and the catalog evidence.
