#!/bin/bash
set -e
pnpm install --frozen-lockfile
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
