/**
 * Synthesis hardening pilot (dev-only, run manually via a console workflow).
 *
 * Picks a few LOW-LINK nodes (cheapest real nodes), runs them through the full
 * hardened background path (durable kb_synthesis_runs report, retries, honest
 * outcomes), prints per-node timing and projects the full-corpus run time.
 * Does NOT run full-corpus synthesis and does not touch prod.
 */
import {
  synthesizeNodesBackground,
  getLastSynthesisRun,
  getSynthesisState,
} from "../lib/kb-synthesis.js";
import { getNodeLinkCounts } from "../lib/kb-topic-index.js";
import { ALL_NODES } from "../lib/kb-taxonomy.js";
import { pool } from "@workspace/db";

const PILOT_NODES = 3;

async function main() {
  const counts = await getNodeLinkCounts();
  const candidates = ALL_NODES
    .map((n) => ({ slug: n.slug, count: counts[n.slug] ?? 0 }))
    .filter((c) => c.count >= 1)
    .sort((a, b) => a.count - b.count);

  const picked = candidates.slice(0, PILOT_NODES);
  const totalLinksAll = candidates.reduce((s, c) => s + c.count, 0);
  console.log(`[pilot] candidate nodes with links: ${candidates.length}, total links: ${totalLinksAll}`);
  console.log(`[pilot] picked:`, picked);

  const startedAt = Date.now();
  const createdIds = await synthesizeNodesBackground(picked.map((p) => p.slug), "pilot");
  const elapsedMs = Date.now() - startedAt;

  const state = getSynthesisState();
  const run = await getLastSynthesisRun();
  console.log(`[pilot] elapsed: ${(elapsedMs / 1000).toFixed(1)}s, drafts created: ${createdIds.length}`);
  console.log(`[pilot] state:`, JSON.stringify({ ...state, failures: state.failures }, null, 2));
  console.log(`[pilot] durable run report:`, JSON.stringify(run, null, 2));

  // Projection: extract cost scales with LINKS (per-source map work dominates),
  // consolidation with nodes. Use per-link timing from the pilot.
  const pilotLinks = picked.reduce((s, p) => s + p.count, 0);
  if (pilotLinks > 0 && run) {
    const perLinkMs = elapsedMs / pilotLinks;
    const projectedMs = perLinkMs * totalLinksAll;
    console.log(
      `[pilot] projection: ${pilotLinks} links took ${(elapsedMs / 60000).toFixed(1)} min → ` +
      `${totalLinksAll} links ≈ ${(projectedMs / 3600000).toFixed(1)} h (upper bound; ` +
      `cached extracts make reruns much cheaper)`,
    );
  }

  const failed = run?.failedCount ?? 0;
  console.log(`[pilot] outcome: succeeded=${run?.succeededCount} skipped=${run?.skippedCount} failed=${failed}`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("[pilot] fatal:", err);
  try { await pool.end(); } catch { /* noop */ }
  process.exit(1);
});
