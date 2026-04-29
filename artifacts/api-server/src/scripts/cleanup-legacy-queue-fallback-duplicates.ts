/**
 * One-shot cleanup script: delete legacy duplicate queue-fallback rows
 * from `audit_log`.
 *
 * For every queue-fallback we used to write a second row with
 * `entityType="communication"` (alongside the surviving
 * `entityType="queue"` row). The duplicate write was removed but the
 * older rows linger until the rolling 30-day cleanup catches them. This
 * script removes them in a single pass.
 *
 * Usage (from the repo root):
 *
 *   DATABASE_URL=postgres://... \
 *     pnpm --filter @workspace/api-server cleanup:queue-fallback-duplicates
 *
 * Safe to run more than once — re-runs match zero rows and exit 0.
 */

import { runLegacyQueueFallbackDuplicateCleanup } from "../lib/queue-fallback-legacy-duplicate-cleanup";

async function main(): Promise<void> {
  const deleted = await runLegacyQueueFallbackDuplicateCleanup();
  console.log(
    `[cleanup-legacy-queue-fallback-duplicates] Done. Removed ${deleted} legacy duplicate row(s).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(
      "[cleanup-legacy-queue-fallback-duplicates] Failed:",
      err,
    );
    process.exit(1);
  });
