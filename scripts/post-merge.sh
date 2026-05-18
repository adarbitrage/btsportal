#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

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
