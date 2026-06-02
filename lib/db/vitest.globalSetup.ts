import { spawnSync } from "node:child_process";

// Apply the idempotent companion SQL migrations to the dev database before
// the drift tests run.
//
// On a freshly cloned/recovered or drifted dev DB the schema-rename
// companion columns (e.g. community_reactions.target_type,
// users.posting_banned_at) are missing because `drizzle-kit push` hangs on
// an interactive rename prompt on non-TTY shells. That makes
// `live-schema-drift.test.ts` fail for the rename foot-gun rather than for a
// genuine schema mismatch.
//
// We deliberately run the companion migrations ONLY (SYNC_MIGRATIONS_ONLY=1)
// and NOT `drizzle-kit push --force`. The companion `.sql` files create only
// the specific columns/objects they declare (all guarded with
// `IF NOT EXISTS`), so a genuinely new schema column that has no migration
// stays missing and the drift test still catches it. push-force would
// silently bring the DB fully in sync and mask exactly the drift these tests
// exist to detect.
//
// This is best-effort and never throws: if the migrations can't be applied
// the drift tests still run and fail with their own actionable message
// pointing at `pnpm --filter @workspace/db sync-dev`.
//
// Skip conditions:
//   - SKIP_DEV_DB_SYNC=1   opt out for fast local iteration
//   - DATABASE_URL unset   the drift tests skip themselves anyway
export default function setup() {
  if (process.env.SKIP_DEV_DB_SYNC === "1") {
    console.log("[vitest] SKIP_DEV_DB_SYNC=1 — skipping companion migration sync");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.log("[vitest] DATABASE_URL not set — skipping companion migration sync");
    return;
  }

  console.log(
    "[vitest] applying companion SQL migrations to dev DB " +
      "(pnpm --filter @workspace/db sync-dev, migrations-only)…",
  );
  const result = spawnSync("pnpm", ["--filter", "@workspace/db", "sync-dev"], {
    stdio: "inherit",
    env: { ...process.env, SYNC_MIGRATIONS_ONLY: "1" },
  });

  // Never fail the suite here: masking drift is worse than a noisy setup.
  // If the sync can't run, the drift tests still execute and report the
  // real state with an actionable message.
  if (result.error) {
    console.warn(
      `[vitest] companion migration sync could not run (${result.error.message}); ` +
        "running drift tests anyway. If they fail for missing rename columns, run " +
        "`pnpm --filter @workspace/db sync-dev`.",
    );
    return;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    console.warn(
      `[vitest] companion migration sync exited ${result.status}; running drift ` +
        "tests anyway. If they fail for missing rename columns, run " +
        "`pnpm --filter @workspace/db sync-dev`.",
    );
  }
}
