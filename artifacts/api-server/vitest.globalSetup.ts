import { spawnSync } from "node:child_process";

// Bring the dev database schema up to date before the suite runs.
//
// Schema renames (column add-vs-rename ambiguities) silently block these
// suites because `drizzle-kit push` stops on an interactive prompt that
// never gets answered on a non-TTY shell. `@workspace/db sync-dev` is the
// non-interactive, idempotent wrapper (companion SQL migrations + push
// --force) that resolves that. Wiring it here means a freshly cloned or
// recovered dev DB picks up new `lib/db/drizzle/*.sql` companion migrations
// automatically — no one has to remember to run the sync by hand.
//
// See lib/db/scripts/sync-dev-db.sh for the mechanics, and replit.md for
// the wiring overview.
//
// Skip conditions (the sync is a convenience, never a hard gate):
//   - SKIP_DEV_DB_SYNC=1     opt out for fast local iteration
//   - DATABASE_URL unset     nothing to sync against; let the tests that
//                            actually need a DB fail on their own terms
export default function setup() {
  if (process.env.SKIP_DEV_DB_SYNC === "1") {
    console.log("[vitest] SKIP_DEV_DB_SYNC=1 — skipping dev DB sync");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.log("[vitest] DATABASE_URL not set — skipping dev DB sync");
    return;
  }

  console.log("[vitest] syncing dev DB schema (pnpm --filter @workspace/db sync-dev)…");
  const result = spawnSync(
    "pnpm",
    ["--filter", "@workspace/db", "sync-dev"],
    { stdio: "inherit" },
  );

  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`dev DB sync failed with exit code ${result.status}`);
  }
}
