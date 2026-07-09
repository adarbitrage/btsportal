/**
 * Full-corpus KB synthesis run (DEV ONLY, per the KB pipeline launch roadmap).
 *
 * Runs every AFFECTED node (new/changed sources or a prior failure) through
 * the hardened background path: durable kb_synthesis_runs report, 429-aware
 * retries, honest per-node outcomes. Already-synthesized, unchanged nodes are
 * excluded up front, so reruns after a partial failure only redo what's needed.
 * Never touches prod.
 */
import {
  synthesizeNodesBackground,
  getAffectedNodes,
  getLastSynthesisRun,
  getSynthesisState,
} from "../lib/kb-synthesis.js";
import { pool } from "@workspace/db";

async function main() {
  const affected = await getAffectedNodes();
  console.log(`[full-run] affected nodes: ${affected.length}`);
  console.log(`[full-run] nodes:`, affected.join(", "));
  if (affected.length === 0) {
    console.log("[full-run] nothing to do — corpus is fully synthesized.");
    await pool.end();
    process.exit(0);
  }

  const startedAt = Date.now();
  const createdIds = await synthesizeNodesBackground(affected, "full-corpus-dev");
  const elapsedMs = Date.now() - startedAt;

  const state = getSynthesisState();
  const run = await getLastSynthesisRun();
  console.log(`[full-run] elapsed: ${(elapsedMs / 3600000).toFixed(2)}h, drafts created: ${createdIds.length}`);
  console.log(`[full-run] state:`, JSON.stringify(state, null, 2));
  console.log(`[full-run] durable run report:`, JSON.stringify(run, null, 2));

  const failed = run?.failedCount ?? 0;
  console.log(`[full-run] outcome: succeeded=${run?.succeededCount} skipped=${run?.skippedCount} failed=${failed}`);
  if (failed > 0) {
    console.log("[full-run] failed nodes remain flagged (lastError) — simply rerun this script to retry ONLY them (cached extracts make it cheap).");
  }
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("[full-run] fatal:", err);
  try { await pool.end(); } catch { /* noop */ }
  process.exit(1);
});
