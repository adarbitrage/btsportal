# 0022_products_entitlement_keys_array_check — verification

This file records the environments in which the
`products_entitlement_keys_is_array` CHECK constraint has been attached, and
the verification that proves it actually rejects the original-bug shape.

The constraint is defined in two places:

- `lib/db/src/schema/products.ts` — Drizzle `check()` on the `products` table.
  `pnpm --filter db push` will attach it on any environment where
  `entitlement_keys` is already clean (i.e. `0021` has been applied).
- `lib/db/drizzle/0022_products_entitlement_keys_array_check.sql` — manual
  SQL companion. Wraps an idempotent `0021`-style UPDATE plus an
  `IF NOT EXISTS`-guarded `ALTER TABLE ... ADD CONSTRAINT` in a single
  transaction, for environments where the data fix has not been applied
  yet (drizzle-kit push would fail there) and so it stays a safe no-op
  if re-run after the schema sync has already attached the constraint.

## Dev DB — 2026-04-29

### Pre-existing state

`SELECT id, slug, jsonb_typeof(entitlement_keys) FROM products` reported
`string` for all 8 rows — `0021` had not actually been applied to this dev
DB despite the Task #329 merge note (its applied.md only documents the
intent; the data migration itself is still a manual step). Re-ran the
`0021` UPDATE manually:

```sql
UPDATE "products"
SET "entitlement_keys" = ("entitlement_keys" #>> '{}')::jsonb
WHERE jsonb_typeof("entitlement_keys") = 'string';
-- UPDATE 8
```

All 8 rows then reported `jsonb_typeof = 'array'` with the expected array
lengths (3, 3, 3, 5, 8, 10, 11, 12 for slugs `reserve_income`, `backroad`,
`offmarket`, `launchpad`, `3month`, `6month`, `1year`, `lifetime`).

### Constraint attached

`pnpm --filter db push` (or, equivalently, the `0022` SQL script above)
attached the constraint cleanly. Catalog verification:

```sql
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = '"products"'::regclass
  AND conname = 'products_entitlement_keys_is_array';
-- conname                                | def
-- products_entitlement_keys_is_array     | CHECK ((jsonb_typeof(entitlement_keys) = 'array'::text))
```

### Bad-shape insert is rejected

Reproducing the original bug shape (`to_jsonb(text)` produces a JSONB
string scalar, mirroring what `JSON.stringify(arr)` + Drizzle's jsonb
mapper produced):

```sql
INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
VALUES ('check-test', 'check test', 'backend',
        to_jsonb('["foo","bar"]'::text), 999);
-- ERROR:  new row for relation "products" violates check constraint
--         "products_entitlement_keys_is_array"
-- DETAIL: Failing row contains (..., "[\"foo\",\"bar\"]", ..., 999, null).
```

A real-array insert succeeds:

```sql
INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
VALUES ('check-test-good', 'check test', 'backend',
        '["foo","bar"]'::jsonb, 999);
-- INSERT 0 1
```

## Regression guards

Two test files lock the contract in CI from complementary angles:

- `artifacts/api-server/src/__tests__/products-entitlement-keys-shape.test.ts`
  asserts the read side (every row decodes to a JS array; raw
  `jsonb_array_elements_text` works) **and** appends two checks for the
  CHECK constraint itself: catalog presence, plus a simulated
  `JSON.stringify`'d insert that must be rejected with SQLSTATE 23514 or
  the constraint name.
- `artifacts/api-server/src/__tests__/products-entitlement-keys-array-check.test.ts`
  exercises the write side end-to-end via the raw `pg` pool (so the
  Postgres SQLSTATE survives the round-trip cleanly): catalog presence,
  rejection of string-scalar / number-scalar / object-scalar inserts,
  rejection of an UPDATE that turns a real array back into a string
  scalar, and positive-path acceptance of a real array (including an
  empty array, to confirm the constraint isn't over-zealous).

The two together cover both halves of "the constraint is real": it is
declared, and it actually rejects every bad shape we know how to produce.

## Production

Pending. Recommended sequence (matches the dev flow above):

1. Apply `0022_products_entitlement_keys_array_check.sql` against the
   production DB via the SQL console. The script wraps both the
   data-repair UPDATE and the idempotent CHECK addition in a single
   transaction, so a stale environment can run it as a one-shot. The
   `IF NOT EXISTS` guard makes it safe to re-run, and safe to apply
   after `pnpm --filter db push` has already attached the constraint.
2. Deploy the schema change so `pnpm --filter db push` sees the constraint
   already in place and treats it as a no-op.
3. Append a verification block here with the date and the catalog/INSERT
   evidence above so this file remains the source of truth for which
   environments are guarded.
