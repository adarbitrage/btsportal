---
name: KB taxonomy columns missing in fresh dev DB
description: Why doc_class/slug/home_root/node/tags/ceiling/handoff/last_verified can be absent from a fresh isolated env's knowledgebase_docs, and how to land them safely.
---

The KB taxonomy columns on `knowledgebase_docs` (doc_class, slug, home_root,
node, tags, blitz_section, ceiling, handoff, last_verified + their indexes) are
declared ONLY in the Drizzle schema (lib/db/src/schema/knowledgebase-docs.ts).
There is NO companion `lib/db/drizzle/*.sql` for them — they follow the additive
-column pattern: prod gets them via publish-time `drizzle-kit push --force`
(gated on the live-schema-drift test), dev gets them via `sync-dev` /the
api-server vitest globalSetup.

**Consequence:** a freshly-cloned isolated agent environment whose dev DB was
never synced will be MISSING these columns. Symptom: `seed-kb` logs
`[seed-kb] Error inserting "..."` for every row (its INSERT lists `doc_class`),
ending `Inserted: 0`, and any home_root/doc_class query throws
`column "..." does not exist`. The api-server boot only runs a few targeted
ALTER migrations (audience, source_path/source_label) — it does NOT push the
schema, so these columns never appear from boot alone.

**Safe fix for dev verification:** apply just these additive columns with
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + `CREATE [UNIQUE] INDEX IF NOT
EXISTS` (mirror the schema exactly), then restart the API. Do NOT run a full
`push --force` to fix it — per drizzle-push-drift it wants to drop unrelated
`sequence_*` columns (dev data loss). Don't add a companion .sql either; that's
the foundational schema task's call and publish-time push-force already covers
prod.
