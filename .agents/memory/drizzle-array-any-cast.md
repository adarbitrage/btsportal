---
name: drizzle ANY(array) record-cast pitfall
description: Why ANY(${jsArray}::int[]) throws "cannot cast type record to integer[]" with drizzle sql template, and the fix
---

When interpolating a JS array into a drizzle `sql` template, drizzle expands it into a
comma-separated **parameter list** (`$1, $2, ...`), which is meant for `IN (...)`. Writing
`WHERE col = ANY(${jsArray}::int[])` therefore produces `ANY(($1,$2,...)::int[])`, which
Postgres parses as a *record* cast and rejects at runtime with:
`error 42846 — cannot cast type record to integer[]`.

It typecheck-passes and only fails at query time, so it slips past CI when no test exercises
the bulk path.

**Fix:** pass a single Postgres array-literal string param instead:
```ts
const idArrayLiteral = `{${userIds.join(",")}}`;
sql`... WHERE col = ANY(${idArrayLiteral}::int[])`;
```
Safe when the ids are DB-sourced integers. Alternatively use
`IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`.

**Why:** the single-value form `col = ${id}` works fine; the trap is specifically
array → `ANY(...)`. Single-row resolvers pass, bulk resolvers blow up.

**How to apply:** any drizzle `db.execute(sql`...ANY(${arr}::T[])`)` over a JS array.
Encountered in the Blitz continue-resolver bulk path feeding the coach dashboard mentee list.
