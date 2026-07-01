---
name: drizzle-zod generated column .omit() throws
description: Why createInsertSchema(...).omit({ <generatedCol>: true }) crashes at boot under zod v4
---

`createInsertSchema(table).omit({ ... })` from drizzle-zod already EXCLUDES any
STORED/generated-always column (e.g. a generated tsvector `searchVector`) from the
produced insert schema. Listing that generated column again in `.omit()` throws
`Error: Unrecognized key: "<col>"` at module-load time under zod v4 — a hard
crash-loop on the server that imports the schema, not a type error.

**Why:** zod v4's `.omit()` validates that every key passed actually exists on the
object shape; the generated column isn't a key, so it's "unrecognized". Typecheck
passes because the omitted-key type still resolves; it only fails at runtime.

**How to apply:** In `.omit()` only list DB-managed identity/timestamp columns
(id, createdAt, updatedAt). Never list a `generatedAlwaysAs()` column — drizzle-zod
drops it for you. If a server crash-loops with `Unrecognized key` pointing at a
schema file's `createInsertSchema(...).omit(...)`, remove the generated column from
the omit list.
