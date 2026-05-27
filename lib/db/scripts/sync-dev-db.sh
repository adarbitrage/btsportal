#!/usr/bin/env bash
# Non-interactive sync of the dev database schema.
#
# `drizzle-kit push` is the deployment mechanism for this project, but it
# stops to ask interactive questions whenever a schema change is
# ambiguous — most often a column rename vs. add (e.g. when the schema
# renames `community_reactions.reaction_type` to `target_type` /
# `type`). On a non-TTY shell (CI, agent runs, scripted setup) push
# silently hangs forever, which is what blocks the admin-config vitest
# suites whenever a rename lands.
#
# To avoid that, we apply every hand-written `lib/db/drizzle/*.sql`
# companion migration first via psql (they're all idempotent, see the
# `applied.md` notes and the IF NOT EXISTS guards in the .sql files).
# Those files create the new columns/tables so that by the time
# `drizzle-kit push --force` runs, the schema diff is unambiguous and
# push proceeds non-interactively.
#
# Usage:
#   DATABASE_URL=... bash lib/db/scripts/sync-dev-db.sh
#   pnpm --filter @workspace/db sync-dev
#
# Exit codes:
#   0 - schema is in sync (push succeeded, or only failed on unrelated
#       pre-existing data-integrity issues which we report and skip).
#   1 - DATABASE_URL missing or psql/pnpm not on PATH.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "sync-dev-db: DATABASE_URL is not set" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "sync-dev-db: psql not found on PATH" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MIG_DIR="${DB_DIR}/drizzle"

echo "sync-dev-db: applying SQL companion migrations from ${MIG_DIR}"
for sql in "${MIG_DIR}"/*.sql; do
  [[ -f "$sql" ]] || continue
  name="$(basename "$sql")"
  # ON_ERROR_STOP keeps a single broken statement from masking later
  # ones; idempotent files re-run cleanly, and any real failure here
  # should surface so the operator can investigate (not be silently
  # skipped the way `drizzle-kit push` skips them).
  if ! psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$sql" >/dev/null 2>/tmp/sync-dev-db.err; then
    echo "sync-dev-db: WARNING — $name failed:" >&2
    sed 's/^/  /' /tmp/sync-dev-db.err >&2
    # Continue: companion files may legitimately fail when push already
    # created the same object; the drift test (`lib/db/src/migration-drift.test.ts`)
    # is the canonical place to enforce agreement between push and SQL.
  fi
done

echo "sync-dev-db: running drizzle-kit push --force"
cd "$DB_DIR"
# Stdin is closed so push fails loudly instead of hanging if it still
# wants to ask something. Anything that wasn't covered by the SQL files
# is a real ambiguity that should be turned into a new companion
# migration rather than answered interactively.
push_log="$(mktemp -t sync-dev-db-push.XXXXXX)"
trap 'rm -f "$push_log" /tmp/sync-dev-db.err' EXIT
if pnpm push-force </dev/null >"$push_log" 2>&1; then
  cat "$push_log"
  push_ok=1
else
  status=$?
  cat "$push_log"
  # Only tolerate the narrow class of failures we've explicitly seen:
  # a CHECK constraint on a legacy row that the schema enforces but a
  # pre-existing row violates (e.g. `vault_resources_tags_is_array`).
  # Those are real data-integrity issues but they don't affect whether
  # the admin-config schema is in sync, which is what this script is
  # responsible for. Any other failure (connectivity, auth, drizzle
  # config, NEW prompt) is propagated so callers / CI notice.
  if grep -qE 'check constraint ".*" of relation ".*" is violated by some row' "$push_log"; then
    echo "sync-dev-db: push failed on a pre-existing CHECK violation;" >&2
    echo "sync-dev-db: companion .sql files were applied, so the schema" >&2
    echo "sync-dev-db: changes needed by admin-config tests are in place." >&2
    echo "sync-dev-db: investigate the offending row separately." >&2
    push_ok=0
  else
    echo "sync-dev-db: drizzle-kit push exited $status with an" >&2
    echo "sync-dev-db: unrecognized error — propagating failure." >&2
    exit "$status"
  fi
fi

# Concretely verify the columns the admin-config suites depend on landed.
# If the SQL files were renumbered / deleted without an equivalent rename
# of `users.posting_banned_at` or the `community_reactions` target_*
# columns, this catches it instead of silently letting the tests fail.
echo "sync-dev-db: verifying expected schema landed"
missing="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<'SQL'
WITH expected(table_name, column_name) AS (
  VALUES
    ('users',                'posting_banned_at'),
    ('community_reactions',  'target_type'),
    ('community_reactions',  'target_id'),
    ('community_reactions',  'type')
)
SELECT e.table_name || '.' || e.column_name
  FROM expected e
  LEFT JOIN information_schema.columns c
    ON c.table_name  = e.table_name
   AND c.column_name = e.column_name
   AND c.table_schema = 'public'
 WHERE c.column_name IS NULL;
SQL
)"
if [[ -n "$missing" ]]; then
  echo "sync-dev-db: ERROR — expected columns are still missing:" >&2
  printf '  %s\n' $missing >&2
  exit 1
fi

if [[ "$push_ok" == "1" ]]; then
  echo "sync-dev-db: done"
else
  echo "sync-dev-db: done (push reported a tolerated CHECK violation)"
fi
