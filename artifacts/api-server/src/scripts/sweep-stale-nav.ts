/**
 * ONE-TIME stale-navigation sweep (Task #1808). Run MANUALLY after merge —
 * never at boot, never on a schedule.
 *
 * Re-screens every needs_review synthesis draft in kb_staging_docs with the
 * expanded legacy crosswalk AND runs an LLM navigation audit against the
 * current portal nav map, appending NAVIGATION CONFLICT reviewer callouts
 * only. Idempotent — safe to re-run.
 *
 * Run via a console workflow so AI_INTEGRATIONS_OPENAI_* secrets are present:
 *   npx tsx artifacts/api-server/src/scripts/sweep-stale-nav.ts
 * (The review queue lives in the DEV database; prod never runs the pipeline.)
 */
import { sweepStaleNavigation } from "../lib/kb-nav-sweep.js";
import { callLLMWithRetry } from "../lib/kb-synthesis.js";

const NAV_AUDIT_MAX_TOKENS = 6000;

async function main() {
  console.log("[sweep] starting one-time stale-navigation sweep…");
  const t0 = Date.now();
  const summary = await sweepStaleNavigation((system, user) =>
    callLLMWithRetry("stale-nav audit", system, user, NAV_AUDIT_MAX_TOKENS, true, false),
  );
  console.log(`[sweep] done in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(
    "[sweep] summary:",
    JSON.stringify(
      {
        docsScanned: summary.docsScanned,
        docsFlagged: summary.docsFlagged,
        deterministicPhrases: summary.deterministicPhrases,
        llmClaims: summary.llmClaims,
        llmErrors: summary.llmErrors,
      },
      null,
      2,
    ),
  );
  process.exit(summary.llmErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[sweep] FATAL:", err);
  process.exit(1);
});
