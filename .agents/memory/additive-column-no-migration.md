---
name: Additive columns skip companion migration
description: When a new DB column needs (or doesn't need) a hand-written drizzle/*.sql migration file
---
A purely additive column — `NOT NULL DEFAULT <const>` or nullable — does NOT need a companion `lib/db/drizzle/*.sql` migration.

**Why:** post-merge (`scripts/post-merge.sh`) gates `drizzle-kit push --force` on `live-schema-drift.test.ts` (which verifies tables/columns). When a schema-only column change merges, that test fails on the prod/dev DB, push-force runs, and adds the additive column with its default cleanly — no rename prompt, no constraint-on-bad-data abort. The migration-drift test compares only constraints/indexes, not columns, so it stays green either way.

**How to apply:** add the field to `lib/db/src/schema/*.ts`, run a targeted `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on the dev DB so local tests pass. Only write a companion `.sql` (and wire it into post-merge.sh) when you ALSO need a data backfill, a column rename, or a CHECK/UNIQUE constraint that push can't apply non-interactively.
