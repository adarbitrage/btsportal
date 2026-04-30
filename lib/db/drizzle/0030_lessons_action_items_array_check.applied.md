# 0030_lessons_action_items_array_check — verification

This file records the environments in which the two
`*_action_items_is_array` CHECK constraints (one each on `lessons`,
`lesson_versions`) have been attached, and the verification that proves
they actually reject the original-bug shape.

The constraints are defined in two places:

- `lib/db/src/schema/lessons.ts` and
  `lib/db/src/schema/lesson-versions.ts` — Drizzle `check()` on each of
  the two lesson tables. The `actionItems` columns also carry an explicit
  `$type<LessonActionItem[]>()` element annotation, with
  `LessonActionItem` exported from `lessons.ts`.
- `lib/db/drizzle/0030_lessons_action_items_array_check.sql` — manual
  SQL companion. Wraps two idempotent string-scalar UPDATEs plus two
  `IF NOT EXISTS`-guarded `ALTER TABLE ... ADD CONSTRAINT` statements
  in a single transaction.

## Dev DB — 2026-04-30

### Pre-existing state

```sql
SELECT 'lessons' AS tbl, jsonb_typeof(action_items) AS shape, count(*)
FROM lessons GROUP BY shape
UNION ALL
SELECT 'lesson_versions', jsonb_typeof(action_items), count(*)
FROM lesson_versions GROUP BY jsonb_typeof(action_items);
--      tbl       | shape | count
-- ---------------+-------+-------
--  lessons         |       |    76
--  lesson_versions |       |    25
```

Both tables held 76 / 25 rows respectively, all with `NULL` action_items
(the seed does not write any action items into lessons or lesson
versions), so there were no string-scalar rows to repair. The two
repair UPDATEs in `0030` ran cleanly (`UPDATE 0` each), confirming the
data-fix half is a safe no-op when the data is already clean.

### Constraints attached

```sql
SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conname IN (
  'lessons_action_items_is_array',
  'lesson_versions_action_items_is_array'
)
ORDER BY conname;
-- lesson_versions | lesson_versions_action_items_is_array | CHECK (((action_items IS NULL) OR (jsonb_typeof(action_items) = 'array'::text)))
-- lessons         | lessons_action_items_is_array         | CHECK (((action_items IS NULL) OR (jsonb_typeof(action_items) = 'array'::text)))
```

Both constraints accept NULL because `action_items` is a nullable
column on each table.

`pnpm --filter db push` was attempted to confirm the schema declarations
match. The push surfaced an unrelated pre-existing failure on the
`vault_resources_tags_is_array` constraint added by `0027` (the dev DB
holds bad-shape `vault_resources.tags` rows the `0027` SQL repair has
not been applied to in this environment), so it could not complete.
This does not affect the two lesson constraints — the SQL companion
attached them directly via `psql` and the catalog query above confirms
both are present with the expected definition.

### Bad-shape inserts are rejected

Pinned by the regression test
`artifacts/api-server/src/__tests__/lessons-action-items-array-check.test.ts`,
which seeds a self-contained track + module + parent lesson chain to
satisfy the FK constraints, then asserts SQLSTATE 23514 + the expected
`conname` for string-scalar, number-scalar, and object-scalar INSERTs
into `lessons`, plus an UPDATE that turns an existing array into a
string scalar; happy-path real-array, empty-array, and explicit-NULL
INSERTs are accepted. The same bad-shape / happy-path coverage runs
against `lesson_versions` against the seeded parent lesson. All 13
tests pass against the dev DB.

## Production

Pending. Recommended sequence:

1. **Run a sanity query first** — historically the same `JSON.stringify`
   pattern that broke `vault_resources.tags` was used in lesson admin
   tooling, so before applying anything, run the diagnostic query above
   against production. If any `string` rows exist, the migration's
   UPDATEs will repair them; capture the counts for the verification
   block below.
2. Apply `0030_lessons_action_items_array_check.sql` against the
   production DB via the SQL console. The script is idempotent.
3. Deploy the schema change so `pnpm --filter db push` sees the
   constraints already in place.
4. Append a verification block here with the date, any repair counts,
   and the catalog evidence.
