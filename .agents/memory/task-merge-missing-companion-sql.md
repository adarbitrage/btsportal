---
name: Task-merge post-merge failure — missing companion .sql
description: When a merged task adds schema only via ad-hoc ALTERs in its own env, the shared post-merge fails; fix by writing the companion .sql the task skipped.
---

# Task-merge post-merge failure: missing companion .sql / baseline

A task agent that develops in an isolated environment can make the dev DB schema
right *there* with hand-run `ALTER`/`CREATE` (or a `push` that hung), then merge
**without** committing the companion `lib/db/drizzle/*.sql` files. On merge, the
shared post-merge runs against the real dev DB, the live-schema-drift gate sees
the missing tables/columns, routes to `drizzle-kit push --force`, and that
hangs/EOFs on an interactive prompt under the non-TTY post-merge → post-merge
FAILS. (Seen with the KB taxonomy foundation merge: 2 new tables
[kb_transcript_sources, kb_doc_provenance] + 9 nullable `knowledgebase_docs`
columns, none of which had companion .sql or a post-merge step.)

## Fix pattern (main agent, on main)
1. For each missing object, write an **idempotent** companion `.sql`
   (`CREATE TABLE/COLUMN/INDEX IF NOT EXISTS`, guarded `ADD CONSTRAINT` via
   `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL`) that mirrors the
   drizzle schema EXACTLY. Number them so FK dependencies sort first.
2. Add explicit `psql -f` lines to `scripts/post-merge.sh` **before** the drift
   gate (the additive-table steps, e.g. the "step N" blocks). This keeps the
   gate green so `push --force` is skipped entirely — same reason removals need
   an explicit DROP step.
3. Apply the .sql to the dev DB now (`psql "$DATABASE_URL" -f ...`).
4. live-schema-drift only fails on the FIRST unmet check (tables, THEN columns,
   THEN types) — fixing tables can reveal a second wave of missing columns. Run
   it again after each fix until green.
5. migration-drift: the task agent likely recorded the new objects as
   `onlyInPush` in `expected-drift.json`. Once your .sql creates them in the
   migrations path too, they drop OUT of that diff, so the baseline is stale —
   regenerate with `UPDATE_DRIFT_BASELINE=1 ... vitest run src/migration-drift.test.ts`
   AFTER eyeballing the git diff (only your intended objects should move).

**Why:** post-merge runs `push --force` only when the drift gate fails, and that
push is the unreliable/slow step on this DB. Idempotent companion .sql applied
before the gate is the project's standard way to land additive schema in both
dev and (on publish) prod without ever invoking push.
