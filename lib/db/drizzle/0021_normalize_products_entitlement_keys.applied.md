# 0021_normalize_products_entitlement_keys — verification

This project uses `drizzle-kit push`, which only syncs schema (not data),
so the data-conversion in `0021_normalize_products_entitlement_keys.sql`
does not get applied automatically. This note records the dev-environment
verification so the work has an in-repo audit trail; production runs
should append their own block when they apply.

## Pre-migration state (dev DB)

```sql
SELECT id, slug, jsonb_typeof(entitlement_keys) AS jt FROM products ORDER BY id;
```

All 8 rows: `jt = 'string'` (JSONB string scalars containing a serialized
array, e.g. `"[\"content:frontend\", \"support:basic\", \"chat:basic\"]"`).
Raw `SELECT jsonb_array_elements_text(entitlement_keys) FROM products`
errored with **"cannot extract elements from a scalar value"**, and
`SELECT count(*) FROM products WHERE entitlement_keys @> '"community:access"'::jsonb`
returned **0** even though four products grant `community:access`.

### Pre-migration entitlement diagnostic

`getUserEntitlements`-equivalent query (computed against the
JSON-decoded shape so it stays comparable across the migration):

| user_id | name        | active products            | entitlement set |
| ------- | ----------- | -------------------------- | --------------- |
| 2       | Sarah Chen  | 6month, reserve_income     | `{chat:basic, chat:full, coaching:group, coaching:mastermind, commissions:mid, community:access, content:advanced, content:frontend, software:base, software:expanded, support:basic, support:unlimited}` |
| 5       | Lisa Thompson | (none — 3month expired 2026-04-26) | `{}` (empty) |
| 9       | Bruce Clark | lifetime                   | `{access:lifetime, chat:custom, coaching:group, coaching:mastermind, coaching:one_on_one:weekly, commissions:top, community:access, content:advanced, content:frontend, software:base, software:expanded, support:vip}` |

## Migration applied

Ran `0021_normalize_products_entitlement_keys.sql` against the dev DB on
**2026-04-29**. Result: `UPDATE 8`.

## Post-migration state (dev DB)

`SELECT id, slug, jsonb_typeof(entitlement_keys) AS jt FROM products`
now reports `jt = 'array'` for all 8 rows. Raw
`SELECT jsonb_array_elements_text(entitlement_keys) FROM products` runs
without error, and
`SELECT count(*) FROM products WHERE entitlement_keys @> '"community:access"'::jsonb`
now correctly returns **4** (3month, 6month, 1year, lifetime).

### Post-migration entitlement diagnostic

Same query, re-run after the migration:

| user_id | name        | entitlement set |
| ------- | ----------- | --------------- |
| 2       | Sarah Chen  | identical to pre-migration capture above |
| 5       | Lisa Thompson | identical (still empty — no active products) |
| 9       | Bruce Clark | identical to pre-migration capture above |

`getUserEntitlements` returns the same key sets as before for all three
users, satisfying the "Done looks like" criteria for task #329.

## Regression guard

`artifacts/api-server/src/__tests__/products-entitlement-keys-shape.test.ts`
asserts both shapes (Drizzle-decoded JS array and raw JSONB array) on
every run, so an unrepaired environment or a future regression in the
seed/insert path will fail in CI.

## Production

Pending. When applied to production, append a block here with the
verification SQL output and date so this file remains the source of
truth for which environments are normalized.
