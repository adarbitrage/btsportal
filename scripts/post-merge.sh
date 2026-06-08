#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Apply data-repair and column-shape migrations BEFORE `drizzle-kit push`,
# so push has a clean slate to sync the schema non-interactively.
#
# Why each of these is needed:
#
# 1. 0027_vault_resources_tags_array_check.sql
#    Reshapes already-seeded `vault_resources.tags` rows that landed as
#    JSONB string scalars (the bug fixed in #329) back into JSONB arrays
#    AND attaches the matching CHECK constraint. If we skip this, `push`
#    aborts with `vault_resources_tags_is_array is violated by some row`
#    because the constraint addition validates the bad legacy data.
#
# 2. 0038_community_reactions_target_type.sql
#    Adds `target_type` / `target_id` / `type` to `community_reactions`
#    and backfills them from the legacy `post_id` / `comment_id` columns.
#    Without this, `drizzle-kit push` sees a new `target_type` column in
#    the schema and an unrelated legacy column (`reaction_type`) in the
#    DB, and stops on an interactive rename prompt
#    ("Is target_type … created or renamed from another column?") that
#    `--force` does NOT auto-answer — rename detection is separate from
#    data-loss confirmation. Applying the SQL first means `target_type`
#    already exists in the DB, so push has no rename to disambiguate.
#
# Both files are written to be idempotent (guarded ADD COLUMN / ADD
# CONSTRAINT / UPDATE WHERE …), so re-running them against an
# already-migrated database is a safe no-op.
#
# Each block is gated on `to_regclass('public.<table>')` so that on a
# truly empty database (where neither table exists yet) the repair is
# skipped — push-force will create the tables in their final shape, no
# rename prompt or constraint-violation to worry about. The gate only
# fires on drifted databases where the legacy table is already present.
apply_if_table_exists() {
  local table="$1"
  local file="$2"
  local exists
  exists=$(psql "$DATABASE_URL" -tAX -c "SELECT to_regclass('public.${table}') IS NOT NULL;")
  if [ "$exists" = "t" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file" >/dev/null
  fi
}

if [ -n "$DATABASE_URL" ]; then
  apply_if_table_exists vault_resources \
    lib/db/drizzle/0027_vault_resources_tags_array_check.sql
  apply_if_table_exists community_reactions \
    lib/db/drizzle/0038_community_reactions_target_type.sql

  # 3. chat_system_prompts.name UNIQUE constraint.
  #    The schema declares `name` as `.unique()`. On a drifted DB where
  #    the table already exists with rows but no unique constraint,
  #    drizzle-kit push stops on another non-`--force` prompt:
  #        "You're about to add chat_system_prompts_name_unique unique
  #         constraint to the table, which contains N items. … Do you
  #         want to truncate chat_system_prompts table?"
  #    Adding the constraint up front (idempotently) makes push see it
  #    already exists and skip the prompt. On a fresh DB the table
  #    doesn't exist yet, so the gate skips this and push creates the
  #    column + constraint together in one shot — no prompt either way.
  if [ "$(psql "$DATABASE_URL" -tAX -c "SELECT to_regclass('public.chat_system_prompts') IS NOT NULL;")" = "t" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
      DO \$\$ BEGIN
        ALTER TABLE chat_system_prompts
          ADD CONSTRAINT chat_system_prompts_name_unique UNIQUE (name);
      EXCEPTION WHEN duplicate_object THEN NULL;
               WHEN duplicate_table  THEN NULL;
      END \$\$;
    " >/dev/null
  fi
fi

pnpm --filter db push-force

# Belt-and-braces: after pushing, confirm every column declared in
# lib/db/src/schema/ actually landed in the live database. Catches the
# task #561 failure mode where a schema change was committed but never
# pushed (e.g. push-force was skipped, errored partially, or the DB was
# manually altered later). Runs the same vitest file the `db-drift`
# workflow exercises.
pnpm --filter @workspace/db exec vitest run src/live-schema-drift.test.ts

# Run the plan-metadata backfill from task #319. The SQL is fully idempotent
# (each UPDATE is gated on `tagline IS NULL AND highlights = '[]'`), so it
# only writes rows that still have the column defaults from `drizzle-kit push`
# and never clobbers a row an admin has already edited. We invoke psql
# directly because `drizzle-kit push` only syncs schema, not data.
if [ -n "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" \
    -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0033_products_plan_metadata.sql \
    >/dev/null
fi

# Re-scrub knowledgebase_docs through the centralized privacy filter so a
# freshly-synced dev database can never re-introduce a coach surname that was
# already removed (e.g. a stale row copy carrying "Wisbaum"). The script cleans
# both content AND titles; titles carry a UNIQUE constraint, so a scrubbed
# title that would collide with another row is de-duplicated with a numeric
# suffix instead of aborting the run. It only updates rows that actually change,
# so it is idempotent and a no-op when nothing needs cleaning. Keeps the
# kb-coach-name-leak-guard DB test green after every merge without anyone
# running the script by hand.
if [ -n "$DATABASE_URL" ]; then
  pnpm --filter @workspace/api-server exec tsx \
    src/scripts/rescrub-knowledgebase-docs.ts
fi
