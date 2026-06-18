---
name: Drizzle push pre-existing drift
description: Why a full `drizzle-kit push` is unsafe here and how to apply schema changes instead
---
Running a full `pnpm --filter @workspace/db push` reports **pre-existing** data-loss
drift unrelated to your change — it wants to drop columns like
`sequence_steps.{sort_order,template_slug,body,condition,active}`,
`sequences.status`, and `sequence_enrollments.last_step_at` (the live DB has
columns the drizzle schema no longer declares).

**Rule:** Do NOT accept/force a full push to add one column — it will drop those
live columns and lose data.

**How to apply a new column:** run a targeted idempotent SQL ALTER against
`$DATABASE_URL`, e.g.
`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;`
then add the matching field to the drizzle schema in `lib/db/src/schema/`.

**Why:** keeps dev DB and schema in sync for your column without touching the
unrelated drift. The test runner's `sync-dev-db` step also applies the schema, so
keep the SQL and the drizzle definition identical (column name + type + default).

**Post-merge push stalls non-interactively too:** `drizzle-kit push --force` from
`runPostMergeSetup` can hang forever on an interactive prompt — not just for renames
but also a UNIQUE-constraint "truncate table?" question (seen for
`coaching_calls_template_slot_unq`). The live-schema-drift gate that post-merge uses
to decide whether to push is **column-only**, so the escape hatch is: apply just the
missing columns/FKs/constraints to the dev DB via idempotent psql `ALTER ... IF NOT
EXISTS` / `DO $$ ... constraint exists check`, which makes the drift gate pass and
post-merge **skips the push entirely**. Don't try to answer or raise the timeout on
the prompt — make the gate green so push never runs.
