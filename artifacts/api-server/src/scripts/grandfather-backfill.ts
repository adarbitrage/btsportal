/**
 * One-time grandfather backfill CLI (Task #1643, TB2).
 *
 * Report-and-confirm gate: by default this only PRINTS the live tier x
 * onboarding-state bucket matrix and the total it would mark complete +
 * grandfathered. It writes NOTHING unless invoked with BOTH `--execute` and
 * `--confirm`.
 *
 * There are no hardcoded expected counts anywhere in this script or the
 * underlying library — the dev DB drifts continuously with test activity and
 * production is an entirely different dataset, so a fixed number would be
 * wrong on arrival. Read the printed counts and total, and decide from there.
 *
 * Usage (against whatever DATABASE_URL this process's environment points to):
 *   Pre-flight only (writes nothing):
 *     pnpm --filter @workspace/api-server exec tsx src/scripts/grandfather-backfill.ts
 *
 *   Execute (only after reviewing the pre-flight output above):
 *     pnpm --filter @workspace/api-server exec tsx src/scripts/grandfather-backfill.ts --execute --confirm
 *
 * See docs/grandfather-backfill-runbook.md for the full production sequence
 * (production cannot be reached directly by this script — it must be run by
 * a human against production's own DATABASE_URL, or the armed boot hook must
 * be used instead; see the runbook).
 */
import {
  getGrandfatherPreflightReport,
  formatGrandfatherPreflightReport,
  runGrandfatherBackfill,
} from "../lib/grandfather-backfill";

async function main() {
  const args = process.argv.slice(2);
  const wantsExecute = args.includes("--execute");
  const hasConfirm = args.includes("--confirm");

  const report = await getGrandfatherPreflightReport();
  console.log(formatGrandfatherPreflightReport(report));

  if (!wantsExecute) {
    console.log("[GrandfatherBackfill] Pre-flight only — nothing written. Re-run with --execute --confirm to apply.");
    process.exit(0);
  }

  if (!hasConfirm) {
    console.error(
      "[GrandfatherBackfill] Refusing to execute: --execute requires --confirm as well (explicit confirmation). Nothing written.",
    );
    process.exit(1);
  }

  try {
    const result = await runGrandfatherBackfill({ confirm: true });
    if (result.reason === "already_run") {
      console.log("[GrandfatherBackfill] Already ran previously — no-op.");
    } else if (result.executed) {
      console.log(`[GrandfatherBackfill] Done. usersUpdated=${result.usersUpdated}`);
    } else {
      console.log(`[GrandfatherBackfill] Did not execute (reason: ${result.reason ?? "unknown"}).`);
    }
    process.exit(0);
  } catch (err) {
    console.error("[GrandfatherBackfill] FATAL:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[GrandfatherBackfill] FATAL:", err);
  process.exit(1);
});
