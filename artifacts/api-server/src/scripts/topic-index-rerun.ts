/**
 * Task #1794 validation: self-healing topic-index rerun (force=false) followed
 * by a model-quality spot-check. Run via a console workflow so secrets
 * (AI_INTEGRATIONS_OPENAI_*) are present. Logs to stdout; the wrapper appends
 * an EXIT_CODE marker.
 */
import {
  buildTopicIndexBackground,
  getTopicIndexState,
  getLastTopicIndexRun,
  getTopicIndexHealth,
  runTopicIndexQualitySpotCheck,
} from "../lib/kb-topic-index.js";

async function main() {
  console.log("[rerun] starting force=false topic-index rerun…");
  const t0 = Date.now();
  const progressTimer = setInterval(() => {
    const s = getTopicIndexState();
    console.log(
      `[rerun] progress ${s.processed}/${s.total} llm=${s.llmCount} llm_none=${s.llmNoneCount} lexical=${s.lexicalCount} failed=${s.failedCount} excluded=${s.excludedCount}`,
    );
  }, 15000);
  await buildTopicIndexBackground({ force: false });
  clearInterval(progressTimer);
  console.log(`[rerun] done in ${Math.round((Date.now() - t0) / 1000)}s`);

  const run = await getLastTopicIndexRun();
  console.log("[rerun] run report:", JSON.stringify({
    id: run?.id, force: run?.force, total: run?.total, processed: run?.processed,
    llmCount: run?.llmCount, llmNoneCount: run?.llmNoneCount, lexicalCount: run?.lexicalCount,
    failedCount: run?.failedCount, excludedCount: run?.excludedCount, linkedCount: run?.linkedCount,
    error: run?.error, failures: run?.failures?.length, duplicateGroups: run?.duplicateFlags?.length,
  }, null, 2));
  if (run?.failures?.length) {
    console.log("[rerun] failures:", JSON.stringify(run.failures.slice(0, 30), null, 2));
  }
  if (run?.duplicateFlags?.length) {
    console.log("[rerun] duplicate groups:", JSON.stringify(run.duplicateFlags, null, 2));
  }
  const health = await getTopicIndexHealth();
  console.log("[rerun] corpus health:", JSON.stringify(health, null, 2));

  console.log("[rerun] running model-quality spot-check (18 sources)…");
  const qc = await runTopicIndexQualitySpotCheck(18);
  console.log("[rerun] quality check:", JSON.stringify({
    model: qc.model, sampleSize: qc.sampleSize,
    nodeAgreement: qc.nodeAgreement, meanRelevanceDelta: qc.meanRelevanceDelta,
  }, null, 2));
  console.log("[rerun] per-source:", JSON.stringify(qc.perSource.map((p) => ({
    id: p.sourceDocId, agreement: Number(p.agreement.toFixed(2)),
    delta: p.relevanceDelta === null ? null : Number(p.relevanceDelta.toFixed(2)),
    stored: p.storedNodes, new: p.newNodes, error: p.error,
  })), null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("[rerun] FATAL:", err);
  process.exit(1);
});
