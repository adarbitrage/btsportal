import { getParam } from "../../lib/params";
import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { kbStagingDocsTable, knowledgebaseDocsTable, aiLiveDocumentsTable, aiLiveDocumentVersionsTable, kbDocProvenanceTable, kbTriageAuditLogTable, aiSourceDocumentsTable, kbTranscriptSourcesTable, kbNameFlagDismissalsTable, kbHighlightDismissalsTable, kbFlagResolutionsTable } from "@workspace/db/schema";
import { eq, desc, sql, count, and, ne, isNotNull, inArray } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac.js";
import { resolveNavGapsForPublishedDoc } from "../../lib/kb-nav-gaps.js";
import { scrubPrivateContent } from "../../lib/content-privacy-filter";
import {
  undoAutoAction,
  runTriageBackground,
  runAutoTriageOnDoc,
  isTriageRunning,
  rescoreSelfTestForTitle,
} from "../../lib/kb-triage.js";
import { callLLMWithRetry } from "../../lib/kb-synthesis.js";
import { CITABLE_DOC_CLASSES } from "../../lib/kb-taxonomy.js";
import { detectLegacyRefs } from "../../lib/kb-mining.js";
import { blocksBulkConfirm, RISK_FLAG_TYPES, type RiskFlag, type RiskFlagType } from "../../lib/kb-flags.js";
import { buildReviewerSop } from "../../lib/kb-sop.js";
import {
  HOME_ROOTS,
  ALL_NODES,
  DOC_CLASSES,
  CEILINGS,
  HANDOFF_TARGETS,
  getNodeBySlug,
  resolveHomeRoot,
} from "../../lib/kb-taxonomy.js";
import { retrieveSurfaceAware } from "../../lib/kb-retrieval.js";
import { applyRefineEdits } from "../../lib/transcript-cleaner.js";
import { resolveSourceContentForSynthesis } from "../../lib/kb-value-screener.js";
import { analyzeDraftForReview, isPrivacyProtectedPair, HIGHLIGHT_META, type ReviewHighlightKind } from "../../lib/kb-review-risk.js";
import {
  normalizeExcerpt,
  flagFingerprint,
  getDocOutstanding,
  recomputeNeedsExpert,
  retriageDocFlags,
} from "../../lib/kb-flag-lifecycle.js";
import { getNameFlagVocab, invalidateNameFlagVocab } from "../../lib/kb-name-flag-vocab.js";
import { clusterDuplicates, findLiveSimilar } from "../../lib/kb-duplicates.js";
import { embedLiveDocumentInBackground, CLEARED_EMBEDDING_FIELDS } from "../../lib/kb-embeddings.js";
import { getEffectiveTagGroups } from "../../lib/kb-tool-tags.js";
import {
  importBlitzReferenceDocs,
  BLITZ_REFERENCE_IMPORT_SOURCE,
} from "../../lib/blitz-reference-import.js";
import {
  phraseSweepPreview,
  phraseSweepConfirm,
  startConceptSweep,
  isConceptSweepRunning,
  confirmConceptSweep,
  listConceptSweepRuns,
} from "../../lib/kb-corpus-sweep.js";
import { kbCorpusSweepRunsTable } from "@workspace/db/schema";

export { runTriageBackground } from "../../lib/kb-triage.js";

// TEMPORARY (Task #1934): the review dialog currently hides the risk-flags
// section, so the approval gates on unresolved flags / highlights (and the
// bulk-confirm blocking-flag gate) are disabled — hidden flags must not
// silently block approval. Flags are still computed and stored. To re-enable
// the gates when flag review returns to the UI, flip this back to true.
const FLAG_APPROVAL_GATE_ENABLED = false;

const router = Router();
router.use(requirePermission("chat:manage"));

// Blocking-risk predicate (conflict / high-stakes / parked for an expert).
// Single source of truth for both the list filter and the blocking count.
const BLOCKING_SQL = sql`(
  ${kbStagingDocsTable.needsExpert} = true
  OR ${kbStagingDocsTable.riskFlags} @> '[{"type":"conflict"}]'::jsonb
  OR ${kbStagingDocsTable.riskFlags} @> '[{"type":"high_stakes"}]'::jsonb
  OR ${kbStagingDocsTable.riskFlags} @> '[{"type":"source_conflict"}]'::jsonb
)`;

const FLAGGED_SQL = sql`(
  ${kbStagingDocsTable.needsExpert} = true
  OR jsonb_array_length(${kbStagingDocsTable.riskFlags}) > 0
)`;

const STALE_SQL = sql`(
  ${kbStagingDocsTable.staleReferences} IS NOT NULL
  AND jsonb_array_length(${kbStagingDocsTable.staleReferences}) > 0
)`;

// Highest risk floats to the top of the triage queue (foundation §8.9).
const SEVERITY_RANK_SQL = sql`CASE
  WHEN ${kbStagingDocsTable.needsExpert} = true THEN 4
  WHEN ${kbStagingDocsTable.riskFlags} @> '[{"severity":"critical"}]'::jsonb THEN 4
  WHEN ${kbStagingDocsTable.riskFlags} @> '[{"severity":"high"}]'::jsonb THEN 3
  WHEN ${kbStagingDocsTable.riskFlags} @> '[{"severity":"medium"}]'::jsonb THEN 2
  WHEN ${kbStagingDocsTable.riskFlags} @> '[{"severity":"low"}]'::jsonb THEN 1
  ELSE 0
END`;

router.get("/", async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || undefined;
    const search = (req.query.search as string) || undefined;
    // Origin now keys off the clean `origin_type` column (the legacy `source`
    // column is no longer a filter facet).
    const originFilter = (req.query.originType as string) || undefined;
    const docTypeFilter = (req.query.docType as string) || undefined;
    const homeRootFilter = (req.query.homeRoot as string) || undefined;
    const docClassFilter = (req.query.docClass as string) || undefined;
    // Node is now the PRIMARY drill-down (Shelf → Node) for the Synthesis queue.
    const nodeFilter = (req.query.node as string) || undefined;
    const tagFilter = (req.query.tag as string) || undefined;
    // New-vs-Update facet (Synthesis Engine Part 3): 'new' | 'update'. A NULL
    // update_kind is treated as 'new' (the default create path).
    const updateKindFilter = (req.query.updateKind as string) || undefined;
    const riskFilter = (req.query.risk as string) || undefined; // flagged | blocking | needs_expert
    // Source toggle (Task #1914): 'blitz' (imported Blitz reference docs) vs
    // 'transcript' (everything else) vs 'all'. Scopes the list AND every
    // aggregate count so the tabs/facets reflect the selected source.
    const sourceKindFilter = (req.query.sourceKind as string) || undefined;
    const staleOnly = req.query.stale === "true" || req.query.stale === "1";
    const page = parseInt((req.query.page as string) || "1");
    const limit = Math.min(parseInt((req.query.limit as string) || "20"), 100);
    const offset = (page - 1) * limit;

    let where = sql`1=1`;
    if (status && status !== "all") {
      where = sql`${where} AND ${kbStagingDocsTable.status} = ${status}`;
    }
    if (docTypeFilter && docTypeFilter !== "all") {
      where = sql`${where} AND ${kbStagingDocsTable.docType} = ${docTypeFilter}`;
    }
    if (homeRootFilter && homeRootFilter !== "all") {
      where = sql`${where} AND ${kbStagingDocsTable.homeRoot} = ${homeRootFilter}`;
    }
    if (search) {
      where = sql`${where} AND to_tsvector('english', ${kbStagingDocsTable.title} || ' ' || coalesce(${kbStagingDocsTable.editedContent}, ${kbStagingDocsTable.content}, '')) @@ plainto_tsquery('english', ${search})`;
    }
    if (originFilter && originFilter !== "all") {
      if (originFilter === "unlabeled") {
        where = sql`${where} AND (${kbStagingDocsTable.originType} IS NULL OR ${kbStagingDocsTable.originType} = '')`;
      } else {
        where = sql`${where} AND ${kbStagingDocsTable.originType} = ${originFilter}`;
      }
    }
    if (docClassFilter && docClassFilter !== "all") {
      if (docClassFilter === "citable") {
        where = sql`${where} AND ${kbStagingDocsTable.docClassTarget} IN ('curated','overview','navigation')`;
      } else if (docClassFilter === "non_citable") {
        where = sql`${where} AND (${kbStagingDocsTable.docClassTarget} IS NULL OR ${kbStagingDocsTable.docClassTarget} NOT IN ('curated','overview','navigation'))`;
      } else {
        where = sql`${where} AND ${kbStagingDocsTable.docClassTarget} = ${docClassFilter}`;
      }
    }
    if (nodeFilter && nodeFilter !== "all") {
      where = sql`${where} AND ${kbStagingDocsTable.node} = ${nodeFilter}`;
    }
    if (tagFilter && tagFilter !== "all") {
      where = sql`${where} AND ${kbStagingDocsTable.taxonomyTags} @> ${JSON.stringify([tagFilter])}::jsonb`;
    }
    if (updateKindFilter && updateKindFilter !== "all") {
      if (updateKindFilter === "update") {
        where = sql`${where} AND ${kbStagingDocsTable.updateKind} = 'update'`;
      } else {
        // 'new' == the create path: NULL or explicit 'new'.
        where = sql`${where} AND (${kbStagingDocsTable.updateKind} IS NULL OR ${kbStagingDocsTable.updateKind} = 'new')`;
      }
    }
    if (riskFilter === "needs_expert") {
      where = sql`${where} AND ${kbStagingDocsTable.needsExpert} = true`;
    } else if (riskFilter === "blocking") {
      where = sql`${where} AND ${BLOCKING_SQL}`;
    } else if (riskFilter === "flagged") {
      where = sql`${where} AND ${FLAGGED_SQL}`;
    }
    if (staleOnly) {
      where = sql`${where} AND ${STALE_SQL}`;
    }

    // Source scope: applied to the list where-clause AND every aggregate
    // below, so status tabs / facet counts reflect the selected source.
    const BLITZ_SOURCE_SQL = sql`${kbStagingDocsTable.source} = ${BLITZ_REFERENCE_IMPORT_SOURCE}`;
    let sourceScope = sql`1=1`;
    if (sourceKindFilter === "blitz") {
      sourceScope = BLITZ_SOURCE_SQL;
    } else if (sourceKindFilter === "transcript") {
      sourceScope = sql`(${kbStagingDocsTable.source} IS NULL OR ${kbStagingDocsTable.source} <> ${BLITZ_REFERENCE_IMPORT_SOURCE})`;
    }
    where = sql`${where} AND ${sourceScope}`;

    const [docs, total] = await Promise.all([
      db
        .select()
        .from(kbStagingDocsTable)
        .where(where)
        .orderBy(desc(SEVERITY_RANK_SQL), desc(kbStagingDocsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ cnt: count() })
        .from(kbStagingDocsTable)
        .where(where),
    ]);

    const [
      statusCounts,
      originCounts,
      docTypeCounts,
      shelfCounts,
      docClassCounts,
      riskAgg,
      tagRows,
      nodeCountRows,
      updateKindAgg,
      sourceKindAgg,
    ] = await Promise.all([
      db
        .select({ status: kbStagingDocsTable.status, cnt: count() })
        .from(kbStagingDocsTable)
        .where(sourceScope)
        .groupBy(kbStagingDocsTable.status),
      db
        .select({ originType: kbStagingDocsTable.originType, cnt: count() })
        .from(kbStagingDocsTable)
        .where(sourceScope)
        .groupBy(kbStagingDocsTable.originType),
      db
        .select({ docType: kbStagingDocsTable.docType, cnt: count() })
        .from(kbStagingDocsTable)
        .where(sourceScope)
        .groupBy(kbStagingDocsTable.docType),
      db
        .select({ homeRoot: kbStagingDocsTable.homeRoot, cnt: count() })
        .from(kbStagingDocsTable)
        .where(sourceScope)
        .groupBy(kbStagingDocsTable.homeRoot),
      db
        .select({ docClassTarget: kbStagingDocsTable.docClassTarget, cnt: count() })
        .from(kbStagingDocsTable)
        .where(sourceScope)
        .groupBy(kbStagingDocsTable.docClassTarget),
      db.execute(sql`
        SELECT
          count(*) FILTER (WHERE ${BLOCKING_SQL})::int AS blocking,
          count(*) FILTER (WHERE ${FLAGGED_SQL})::int AS flagged,
          count(*) FILTER (WHERE ${kbStagingDocsTable.needsExpert} = true)::int AS needs_expert,
          count(*) FILTER (WHERE ${STALE_SQL})::int AS stale
        FROM ${kbStagingDocsTable}
        WHERE ${sourceScope}
      `),
      db.execute(sql`
        SELECT tag, count(*)::int AS cnt
        FROM ${kbStagingDocsTable}, jsonb_array_elements_text(${kbStagingDocsTable.taxonomyTags}) AS tag
        WHERE ${sourceScope}
        GROUP BY tag
        ORDER BY cnt DESC, tag ASC
      `),
      db
        .select({ node: kbStagingDocsTable.node, cnt: count() })
        .from(kbStagingDocsTable)
        .where(sourceScope)
        .groupBy(kbStagingDocsTable.node),
      db.execute(sql`
        SELECT
          count(*) FILTER (WHERE ${kbStagingDocsTable.updateKind} = 'update')::int AS update_count,
          count(*) FILTER (WHERE ${kbStagingDocsTable.updateKind} IS NULL OR ${kbStagingDocsTable.updateKind} = 'new')::int AS new_count
        FROM ${kbStagingDocsTable}
        WHERE ${sourceScope}
      `),
      // Per-source counts are NEVER scoped — the toggle needs both sides.
      db.execute(sql`
        SELECT
          count(*)::int AS all_count,
          count(*) FILTER (WHERE ${BLITZ_SOURCE_SQL})::int AS blitz_count
        FROM ${kbStagingDocsTable}
      `),
    ]);

    const updateKindRow = (updateKindAgg.rows?.[0] ?? {}) as Record<string, unknown>;
    const sourceKindRow = (sourceKindAgg.rows?.[0] ?? {}) as Record<string, unknown>;
    const sourceAllCount = Number(sourceKindRow.all_count ?? 0);
    const sourceBlitzCount = Number(sourceKindRow.blitz_count ?? 0);

    const citableCount = docClassCounts
      .filter((d) => d.docClassTarget && CITABLE_DOC_CLASSES.includes(d.docClassTarget as never))
      .reduce((s, d) => s + d.cnt, 0);
    const totalAll = docClassCounts.reduce((s, d) => s + d.cnt, 0);

    const riskRow = (riskAgg.rows?.[0] ?? {}) as Record<string, unknown>;

    res.json({
      documents: docs,
      pagination: {
        page,
        limit,
        total: total[0].cnt,
        totalPages: Math.ceil(total[0].cnt / limit),
      },
      statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, s.cnt])),
      originCounts: {
        ...Object.fromEntries(
          originCounts
            .filter((o) => o.originType)
            .map((o) => [o.originType as string, o.cnt]),
        ),
        unlabeled: originCounts
          .filter((o) => !o.originType)
          .reduce((sum, o) => sum + o.cnt, 0),
      },
      docTypeCounts: Object.fromEntries(docTypeCounts.map((d) => [d.docType, d.cnt])),
      docClassCounts: {
        citable: citableCount,
        non_citable: totalAll - citableCount,
        ...Object.fromEntries(
          docClassCounts
            .filter((d) => d.docClassTarget)
            .map((d) => [d.docClassTarget as string, d.cnt]),
        ),
      },
      riskCounts: {
        blocking: Number(riskRow.blocking ?? 0),
        flagged: Number(riskRow.flagged ?? 0),
        needs_expert: Number(riskRow.needs_expert ?? 0),
        stale: Number(riskRow.stale ?? 0),
      },
      sourceKindCounts: {
        all: sourceAllCount,
        blitz: sourceBlitzCount,
        transcript: sourceAllCount - sourceBlitzCount,
      },
      tagCounts: (tagRows.rows as Record<string, unknown>[]).map((r) => ({
        tag: String(r.tag),
        count: Number(r.cnt ?? 0),
      })),
      shelfCounts: shelfCounts
        .filter((s) => s.homeRoot)
        .map((s) => ({ homeRoot: s.homeRoot as string, count: s.cnt }))
        .sort((a, b) => b.count - a.count),
      nodeCounts: nodeCountRows
        .filter((n) => n.node)
        .map((n) => ({ node: n.node as string, count: n.cnt }))
        .sort((a, b) => b.count - a.count),
      updateKindCounts: {
        new: Number(updateKindRow.new_count ?? 0),
        update: Number(updateKindRow.update_count ?? 0),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── AI analysis endpoints (must be BEFORE /:id to avoid capture) ────────────
//
// Triage no longer auto-approves/rejects (no thresholds). It only analyzes:
// suggested metadata + risk flags + always needs_review.

router.post("/run-triage", async (req: Request, res: Response) => {
  try {
    if (isTriageRunning()) {
      res.json({ message: "Triage is already running", running: true });
      return;
    }

    const { ids, includeStatuses, includeAnalyzed } = req.body as {
      ids?: number[];
      includeStatuses?: string[];
      includeAnalyzed?: boolean;
    };

    const statuses = includeStatuses ?? ["pending_review", "needs_review"];

    let targetDocs: (typeof kbStagingDocsTable.$inferSelect)[];

    if (ids && ids.length > 0) {
      targetDocs = await db
        .select()
        .from(kbStagingDocsTable)
        .where(sql`${kbStagingDocsTable.id} = ANY(${ids})`);
    } else {
      // Default: only docs never analyzed (no aiRecommendedAction stamp).
      // includeAnalyzed=true opts into re-analyzing everything in scope.
      targetDocs = await db
        .select()
        .from(kbStagingDocsTable)
        .where(
          includeAnalyzed
            ? sql`${kbStagingDocsTable.status} = ANY(${statuses})`
            : sql`${kbStagingDocsTable.status} = ANY(${statuses}) AND ${kbStagingDocsTable.aiRecommendedAction} IS NULL`,
        );
    }

    if (targetDocs.length === 0) {
      res.json({ message: includeAnalyzed ? "No documents to analyze" : "No unanalyzed documents — every doc in scope already has an AI analysis.", triaged: 0 });
      return;
    }

    res.json({
      message: `Starting AI analysis on ${targetDocs.length} document(s) in background.`,
      total: targetDocs.length,
      running: true,
    });

    // runTriageBackground manages _triageRunning internally; safe to fire-and-forget
    runTriageBackground(targetDocs).catch((err) =>
      console.error("[KB Triage] Unhandled error in background run:", err),
    );
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * Synchronous single-doc AI analysis (review-dialog "Analyze with AI"). Blocks
 * until done so the reviewer sees results in place. Refused while a batch run
 * is in flight (shared LLM budget + the batch may already cover this doc).
 */
router.post("/:id/analyze", async (req: Request, res: Response) => {
  try {
    if (isTriageRunning()) {
      res.status(409).json({ error: "A batch AI analysis is already running — try again when it finishes." });
      return;
    }
    const id = parseInt(getParam(req.params.id));
    const [doc] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const result = await runAutoTriageOnDoc(doc);
    const [updated] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, id));
    res.json({ result, document: updated });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * Title-suggestion lifecycle (Task #1865). The AI-suggested title
 * (aiCleanedTitle) is only ever a SUGGESTION — the stored title is what
 * displays and publishes. Accept applies it; dismiss keeps the stored title
 * and re-scores the stored retrieval self-test (retrieval only, no LLM)
 * against it. Nothing is ever auto-applied. The decision does NOT lock:
 * analysis always re-proposes a fresh suggestion and clears the prior
 * accept/dismiss/edit decision so it is actionable on click.
 */
router.post("/:id/title-suggestion/accept", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const [doc] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    if (!doc.aiCleanedTitle?.trim()) {
      res.status(400).json({ error: "No AI title suggestion to accept" });
      return;
    }
    if (doc.aiTitleDecision) {
      res.status(409).json({ error: "Title suggestion already decided" });
      return;
    }
    const accepted = doc.aiCleanedTitle.trim();
    await db
      .update(kbStagingDocsTable)
      .set({ title: accepted, aiTitleDecision: "accepted" })
      .where(eq(kbStagingDocsTable.id, id));
    // The self-test was scored against the (former) stored title — re-score it
    // against the newly-accepted title so the verdict is honest. Retrieval only.
    await rescoreSelfTestForTitle({ ...doc, aiTitleDecision: "accepted" }, accepted);
    const [updated] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, id));
    res.json(updated);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/:id/title-suggestion/dismiss", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const [doc] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    if (!doc.aiCleanedTitle?.trim()) {
      res.status(400).json({ error: "No AI title suggestion to dismiss" });
      return;
    }
    if (doc.aiTitleDecision) {
      res.status(409).json({ error: "Title suggestion already decided" });
      return;
    }
    await db
      .update(kbStagingDocsTable)
      .set({ aiTitleDecision: "dismissed" })
      .where(eq(kbStagingDocsTable.id, id));
    // The self-test was scored against the (now-rejected) suggestion — re-score
    // it against the stored title so the verdict is honest. Retrieval only.
    await rescoreSelfTestForTitle({ ...doc, aiTitleDecision: "dismissed" }, doc.title);
    const [updated] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, id));
    res.json(updated);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});


router.get("/triage-status", async (_req: Request, res: Response) => {
  try {
    const [triaged, pending, needsReview, unanalyzed] = await Promise.all([
      db.select({ cnt: count() }).from(kbStagingDocsTable).where(isNotNull(kbStagingDocsTable.aiRecommendedAction)),
      db.select({ cnt: count() }).from(kbStagingDocsTable).where(eq(kbStagingDocsTable.status, "needs_review")),
      db.select({ cnt: count() }).from(kbStagingDocsTable).where(eq(kbStagingDocsTable.status, "needs_review")),
      db
        .select({ cnt: count() })
        .from(kbStagingDocsTable)
        .where(
          sql`${kbStagingDocsTable.status} IN ('pending_review','needs_review') AND ${kbStagingDocsTable.aiRecommendedAction} IS NULL`,
        ),
    ]);
    const autoActions = await db
      .select({
        action: kbStagingDocsTable.autoAction,
        cnt: count(),
      })
      .from(kbStagingDocsTable)
      .where(isNotNull(kbStagingDocsTable.autoAction))
      .groupBy(kbStagingDocsTable.autoAction);

    res.json({
      running: isTriageRunning(),
      triaged: triaged[0].cnt,
      pendingTriage: pending[0].cnt,
      needsReview: needsReview[0].cnt,
      unanalyzed: unanalyzed[0].cnt,
      autoActions: Object.fromEntries(autoActions.map((a) => [a.action, a.cnt])),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/auto-actions", async (req: Request, res: Response) => {
  try {
    const page = parseInt((req.query.page as string) || "1");
    const limit = Math.min(parseInt((req.query.limit as string) || "50"), 100);
    const offset = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      db
        .select()
        .from(kbStagingDocsTable)
        .where(isNotNull(kbStagingDocsTable.autoAction))
        .orderBy(desc(kbStagingDocsTable.autoActionAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ cnt: count() })
        .from(kbStagingDocsTable)
        .where(isNotNull(kbStagingDocsTable.autoAction)),
    ]);

    res.json({
      documents: docs,
      pagination: {
        page,
        limit,
        total: total[0].cnt,
        totalPages: Math.ceil(total[0].cnt / limit),
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Duplicate grouping & merge aid (Task #1825) ──────────────────────────────
//
// Review aids for the ~66 glossary-style synthesis drafts that synthesized the
// same concept once per taxonomy node. All endpoints here are review-time only:
// nothing auto-approves/publishes, and the live-corpus similarity indicator is
// informational (it never blocks approval or modifies the live doc).

/** Non-deleted live docs, projected for similarity matching. */
async function loadLiveDocsForSimilarity() {
  return db
    .select({
      id: aiLiveDocumentsTable.id,
      title: aiLiveDocumentsTable.title,
      content: aiLiveDocumentsTable.content,
    })
    .from(aiLiveDocumentsTable)
    .where(sql`${aiLiveDocumentsTable.deletedAt} IS NULL`);
}

// Clusters of likely-same-concept needs-review drafts. Docs with no likely
// duplicate are excluded. Each doc also carries its "similar live doc" match.
router.get("/duplicates", async (_req: Request, res: Response) => {
  try {
    const allDocs = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.status, "needs_review"));

    // Unconfirmed AI merge drafts (Task #1902) are near-copies of their own
    // source drafts, so they would always cluster with them — exclude them
    // from clustering and surface them separately for confirm/discard.
    const pendingDraftRows = allDocs.filter(
      (d) => Array.isArray(d.pendingMergeSourceIds) && d.pendingMergeSourceIds.length > 0,
    );
    const docs = allDocs.filter((d) => !pendingDraftRows.includes(d));

    const clusterInputs = docs.map((d) => ({
      id: d.id,
      title: d.title,
      content: d.editedContent ?? d.content,
    }));
    const clusters = clusterDuplicates(clusterInputs);

    const clusteredIds = new Set(clusters.flatMap((c) => c.docIds));
    const liveDocs = await loadLiveDocsForSimilarity();
    const byId = new Map(docs.map((d) => [d.id, d]));
    const allById = new Map(allDocs.map((d) => [d.id, d]));

    const payload = clusters.map((c) => ({
      key: c.key,
      docs: c.docIds
        .map((id) => byId.get(id))
        .filter((d): d is NonNullable<typeof d> => Boolean(d))
        .map((d) => ({
          ...d,
          liveSimilar: findLiveSimilar(
            { title: d.title, content: d.editedContent ?? d.content, targetLiveDocId: d.targetLiveDocId },
            liveDocs,
          ),
        })),
    }));

    // Pending drafts carry their source titles so the UI can show what each
    // draft proposes to replace (sources may have been resolved elsewhere —
    // report only the ones still in needs_review as foldable).
    const pendingDrafts = pendingDraftRows.map((d) => {
      const sourceIds = (d.pendingMergeSourceIds ?? []) as number[];
      return {
        id: d.id,
        title: d.title,
        homeRoot: d.homeRoot,
        node: d.node,
        createdAt: d.createdAt,
        sourceIds,
        sources: sourceIds.map((sid) => {
          const src = allById.get(sid);
          return {
            id: sid,
            title: src?.title ?? null,
            stillMergeable: src != null && !pendingDraftRows.includes(src),
          };
        }),
      };
    });

    res.json({ clusters: payload, clusteredDocCount: clusteredIds.size, pendingDrafts });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Drafts previously merged into a canonical during cluster resolution, grouped
// by the canonical they were folded into. Merged drafts leave the needs-review
// pool so they never show up in /duplicates — this feeds the "Restore" list on
// the Possible Duplicates screen so a wrong merge can be undone here.
router.get("/duplicates/merged", async (_req: Request, res: Response) => {
  try {
    const mergedDocs = await db
      .select({
        id: kbStagingDocsTable.id,
        title: kbStagingDocsTable.title,
        homeRoot: kbStagingDocsTable.homeRoot,
        node: kbStagingDocsTable.node,
        mergedIntoId: kbStagingDocsTable.mergedIntoId,
        createdAt: kbStagingDocsTable.createdAt,
      })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.status, "merged"));

    // Only merges we can offer a restore-into context for (mergedIntoId set).
    const withCanonical = mergedDocs.filter(
      (d): d is typeof d & { mergedIntoId: number } => d.mergedIntoId != null,
    );

    const canonicalIds = [...new Set(withCanonical.map((d) => d.mergedIntoId))];
    const canonicalRows = canonicalIds.length
      ? await db
          .select({
            id: kbStagingDocsTable.id,
            title: kbStagingDocsTable.title,
            status: kbStagingDocsTable.status,
          })
          .from(kbStagingDocsTable)
          .where(inArray(kbStagingDocsTable.id, canonicalIds))
      : [];
    const canonicalById = new Map(canonicalRows.map((c) => [c.id, c]));

    const groupsMap = new Map<
      number,
      {
        canonicalId: number;
        canonicalTitle: string | null;
        canonicalStatus: string | null;
        docs: Array<{ id: number; title: string; homeRoot: string | null; node: string | null; createdAt: Date }>;
      }
    >();
    for (const d of withCanonical) {
      let g = groupsMap.get(d.mergedIntoId);
      if (!g) {
        const canon = canonicalById.get(d.mergedIntoId);
        g = {
          canonicalId: d.mergedIntoId,
          canonicalTitle: canon?.title ?? null,
          canonicalStatus: canon?.status ?? null,
          docs: [],
        };
        groupsMap.set(d.mergedIntoId, g);
      }
      g.docs.push({ id: d.id, title: d.title, homeRoot: d.homeRoot, node: d.node, createdAt: d.createdAt });
    }

    const groups = [...groupsMap.values()].sort(
      (a, b) => b.docs.length - a.docs.length || (a.canonicalTitle ?? "").localeCompare(b.canonicalTitle ?? ""),
    );

    res.json({ groups, mergedDocCount: withCanonical.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Batch live-corpus similarity for the NORMAL review flow: a map of
// stagingDocId → best similar-live-doc match across all needs-review drafts
// (excluding each draft's own explicit update target).
router.get("/live-similarity", async (_req: Request, res: Response) => {
  try {
    const [docs, liveDocs] = await Promise.all([
      db
        .select({
          id: kbStagingDocsTable.id,
          title: kbStagingDocsTable.title,
          content: kbStagingDocsTable.content,
          editedContent: kbStagingDocsTable.editedContent,
          targetLiveDocId: kbStagingDocsTable.targetLiveDocId,
        })
        .from(kbStagingDocsTable)
        .where(eq(kbStagingDocsTable.status, "needs_review")),
      loadLiveDocsForSimilarity(),
    ]);

    const matches: Record<number, ReturnType<typeof findLiveSimilar>> = {};
    for (const d of docs) {
      const m = findLiveSimilar(
        { title: d.title, content: d.editedContent ?? d.content, targetLiveDocId: d.targetLiveDocId },
        liveDocs,
      );
      if (m) matches[d.id] = m;
    }
    res.json({ matches });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Resolve a duplicate cluster: keep ONE canonical draft (optionally applying a
// reviewer-edited title/content — titles are the live-doc upsert key, so title
// conflicts are settled here) and mark the others merged into it. The canonical
// stays in the normal review flow (status untouched — never auto-approved).
// Idempotent / concurrent-safe: only docs still in needs_review are merged.
router.post("/duplicates/resolve", async (req: Request, res: Response) => {
  try {
    const { canonicalId, mergedIds, title, content, createNew } = req.body as {
      canonicalId?: number;
      mergedIds?: number[];
      title?: string;
      content?: string;
      createNew?: boolean;
    };

    if (!Array.isArray(mergedIds) || mergedIds.length === 0) {
      res.status(400).json({ error: "a non-empty mergedIds array is required" });
      return;
    }

    const userId = (req as unknown as { userId: number }).userId;

    // ── New-canonical path (Task #1893): the AI-merged draft becomes its OWN
    // new needs_review document, and EVERY selected source draft is folded into
    // it — no existing draft is overwritten. Metadata (home root, node, doc
    // class, etc.) is inherited from a source draft so the new doc lands in the
    // same shelf/node. The new doc still goes through normal review.
    if (createNew) {
      const newTitle = typeof title === "string" ? title.trim() : "";
      const newContent = typeof content === "string" ? content.trim() : "";
      if (!newTitle || !newContent) {
        res.status(400).json({ error: "title and content are required to create a merged document" });
        return;
      }

      const sources = await db
        .select()
        .from(kbStagingDocsTable)
        .where(inArray(kbStagingDocsTable.id, mergedIds));
      if (sources.length === 0) {
        res.status(404).json({ error: "No source drafts found to merge" });
        return;
      }
      // Prefer a still-reviewable source as the metadata donor.
      const donor = sources.find((s) => s.status === "needs_review") ?? sources[0];

      // Sentinel to roll the transaction back when nothing actually merges.
      const RESOLVE_NOOP = Symbol("resolve-noop");
      try {
        const result = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(kbStagingDocsTable)
            .values({
              title: newTitle,
              content: newContent,
              category: donor.category,
              status: "needs_review",
              homeRoot: donor.homeRoot,
              node: donor.node,
              docClassTarget: donor.docClassTarget,
              docType: donor.docType,
              audience: donor.audience,
              originType: "ai_synthesized",
            })
            .returning();

          // Conditional flip = idempotent & concurrency-safe: only drafts still
          // in needs_review are folded in; anything already resolved is skipped.
          const merged = await tx
            .update(kbStagingDocsTable)
            .set({ status: "merged", mergedIntoId: created.id })
            .where(
              and(
                inArray(kbStagingDocsTable.id, mergedIds),
                eq(kbStagingDocsTable.status, "needs_review"),
              ),
            )
            .returning({ id: kbStagingDocsTable.id, title: kbStagingDocsTable.title });

          // No draft actually flipped (e.g. a double-submit replay) — roll back
          // so we never orphan an AI-merge doc with nothing merged into it.
          if (merged.length === 0) throw RESOLVE_NOOP;

          for (const m of merged) {
            await tx.insert(kbTriageAuditLogTable).values({
              stagingDocId: m.id,
              eventType: "merged_duplicate",
              confidenceScore: null,
              actorUserId: userId,
              aiReasoning: `Merged into new AI-merged document #${created.id} ("${newTitle}") via cluster resolution.`,
              docTitle: m.title,
            });
          }
          await tx.insert(kbTriageAuditLogTable).values({
            stagingDocId: created.id,
            eventType: "ai_merge_created",
            confidenceScore: null,
            actorUserId: userId,
            aiReasoning: `Created from AI merge of drafts ${merged.map((m) => `#${m.id}`).join(", ")}.`,
            docTitle: created.title,
          });

          return { created, merged };
        });

        res.json({
          canonical: result.created,
          created: true,
          merged: result.merged.length,
          mergedIds: result.merged.map((m) => m.id),
          skipped: mergedIds.filter((id) => !result.merged.some((m) => m.id === id)),
        });
      } catch (txErr) {
        if (txErr === RESOLVE_NOOP) {
          res.status(409).json({ error: "All selected drafts have already been resolved" });
          return;
        }
        throw txErr;
      }
      return;
    }

    // ── Manual-keep path: keep ONE existing draft, fold the rest into it ──
    if (!canonicalId) {
      res.status(400).json({ error: "canonicalId and a non-empty mergedIds array are required" });
      return;
    }
    if (mergedIds.includes(canonicalId)) {
      res.status(400).json({ error: "canonicalId must not be in mergedIds" });
      return;
    }

    const [canonical] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, canonicalId));
    if (!canonical) {
      res.status(404).json({ error: "Canonical document not found" });
      return;
    }
    if (canonical.status !== "needs_review") {
      res.status(409).json({ error: `Canonical document is no longer in needs_review (status: ${canonical.status})` });
      return;
    }

    // Apply reviewer edits to the canonical (status stays needs_review).
    const canonicalUpdates: Record<string, unknown> = {};
    if (typeof title === "string" && title.trim() && title.trim() !== canonical.title) {
      canonicalUpdates.title = title.trim();
    }
    if (typeof content === "string" && content.trim()) {
      canonicalUpdates.editedContent = content;
    }
    if (Object.keys(canonicalUpdates).length > 0) {
      await db
        .update(kbStagingDocsTable)
        .set(canonicalUpdates)
        .where(eq(kbStagingDocsTable.id, canonicalId));
    }

    // Conditional status flip = idempotent & safe under concurrent review: a
    // doc someone else already approved/merged is skipped, never clobbered.
    const merged = await db
      .update(kbStagingDocsTable)
      .set({ status: "merged", mergedIntoId: canonicalId })
      .where(
        and(
          inArray(kbStagingDocsTable.id, mergedIds),
          eq(kbStagingDocsTable.status, "needs_review"),
        ),
      )
      .returning({ id: kbStagingDocsTable.id, title: kbStagingDocsTable.title });

    for (const m of merged) {
      await db.insert(kbTriageAuditLogTable).values({
        stagingDocId: m.id,
        eventType: "merged_duplicate",
        confidenceScore: null,
        actorUserId: userId,
        aiReasoning: `Marked as duplicate of #${canonicalId} ("${(canonicalUpdates.title as string) ?? canonical.title}") via cluster resolution.`,
        docTitle: m.title,
      });
    }

    const [updatedCanonical] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, canonicalId));

    res.json({
      canonical: updatedCanonical,
      merged: merged.length,
      mergedIds: merged.map((m) => m.id),
      skipped: mergedIds.filter((id) => !merged.some((m) => m.id === id)),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Undo a duplicate-cluster merge for ONE draft: restore it to needs_review and
// clear mergedIntoId. Conditional UPDATE (status='merged' only) makes it
// idempotent and safe under concurrent review — a doc someone else already
// touched is never clobbered. Audit trail records the undo.
router.post("/duplicates/unmerge", async (req: Request, res: Response) => {
  try {
    const { id } = req.body as { id?: number };
    if (!id || typeof id !== "number") {
      res.status(400).json({ error: "id is required" });
      return;
    }

    const [doc] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const userId = (req as unknown as { userId: number }).userId;
    const previousMergedIntoId = doc.mergedIntoId;

    // Transaction: the status restore and its audit row land together or not
    // at all — never "restored but no audit trail".
    const restored = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(kbStagingDocsTable)
        .set({ status: "needs_review", mergedIntoId: null })
        .where(
          and(
            eq(kbStagingDocsTable.id, id),
            eq(kbStagingDocsTable.status, "merged"),
          ),
        )
        .returning();
      if (!row) return null;

      await tx.insert(kbTriageAuditLogTable).values({
        stagingDocId: row.id,
        eventType: "unmerged",
        confidenceScore: null,
        actorUserId: userId,
        aiReasoning: `Unmerged from duplicate cluster${previousMergedIntoId ? ` (was merged into #${previousMergedIntoId})` : ""}; restored to needs_review.`,
        docTitle: row.title,
      });
      return row;
    });

    if (!restored) {
      res.status(409).json({ error: `Document is not in merged status (status: ${doc.status})` });
      return;
    }

    res.json({ doc: restored });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// AI merge proposal (Task #1902): generate a "best of" merged draft for the
// selected drafts and PERSIST it immediately as a real needs_review staging doc
// so the reviewer gets the full review surface (refine chat, insights, edits)
// on it right away. The source drafts are NOT touched yet — they stay in
// needs_review until the reviewer explicitly confirms the merge
// (/duplicates/confirm-merge) or the draft is discarded
// (/duplicates/discard-merge). Loud failures (retry helper throws after
// exhausted attempts; no silent fallback).
router.post("/duplicates/propose-merge", async (req: Request, res: Response) => {
  try {
    const { ids } = req.body as { ids?: number[] };
    if (!Array.isArray(ids) || ids.length < 2) {
      res.status(400).json({ error: "At least 2 document ids are required" });
      return;
    }

    const docs = await db
      .select()
      .from(kbStagingDocsTable)
      .where(inArray(kbStagingDocsTable.id, ids));
    if (docs.length < 2) {
      res.status(400).json({ error: "Not enough documents found" });
      return;
    }

    const systemPrompt = `You are merging ${docs.length} VARIANT drafts of the SAME knowledge-base concept into ONE best-of document for BTS (Build Test Scale).
The variants were synthesized independently (one per taxonomy node), so they overlap heavily. Combine the strongest content:
- Keep the clearest explanation of the concept.
- Union the unique, correct details/examples/steps from every variant; drop redundancy.
- WRITE IN NATURAL, FLOWING PROSE, exactly like the rest of the knowledge base reads — mostly well-organized paragraphs that connect related ideas. This is the most important rule.
- DO NOT stuff the document with "##" headings. Do not open a new heading for every idea. Use NO headings at all when the document is short; add at most one or two only if it is genuinely long and a reader would otherwise get lost. Fold heading-fragmented variant content back into readable paragraphs.
- KEEP numbered or bulleted lists ONLY where the content is genuinely list-like — sequential steps, discrete checklist items, or a short set of distinct options. Never convert flowing explanation into a bullet dump.
- Preserve any reviewer-facing markers VERBATIM if present ("> ⚠️ SOURCE CONFLICT (for reviewer):", "[SITUATIONAL]" etc.) — never silently drop them.
- BRAND RULES: say "Build Test Scale" / "BTS" (never "TCE" or "Cherrington"); no coach surnames; support email is support@buildtestscale.com.
Return ONLY JSON: {"title":"<single canonical title>","content":"<full merged prose body>"} — no preamble.`;

    const userContent = docs
      .map((d, i) => `=== VARIANT ${i + 1} (staging #${d.id}) — "${d.title}" [${d.homeRoot ?? "?"}/${d.node ?? "?"}] ===\n${(d.editedContent ?? d.content).substring(0, 9000)}`)
      .join("\n\n");

    // Generous budget: gpt-5 reasoning tokens eat max_completion_tokens; the
    // retry helper also escalates on length starvation.
    const raw = (await callLLMWithRetry("duplicate merge proposal", systemPrompt, userContent, 8000, true)).trim();

    let parsed: { title?: unknown; content?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("AI returned malformed merge-proposal JSON");
    }
    const proposedTitle = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const proposedContent = typeof parsed.content === "string" ? parsed.content.trim() : "";
    if (!proposedContent) {
      throw new Error("AI merge proposal returned empty content");
    }

    const userId = (req as unknown as { userId: number }).userId;
    const sourceIds = docs.map((d) => d.id);
    // Metadata donor: prefer a still-reviewable source so the draft lands in
    // the same shelf/node (mirrors the resolve createNew path).
    const donor = docs.find((s) => s.status === "needs_review") ?? docs[0];

    // Persist the draft + its audit row atomically. The draft is immediately a
    // normal needs_review doc (full review surface works on it); its pending
    // state — "these sources are not folded in yet" — lives in
    // pendingMergeSourceIds until confirm/discard.
    const draft = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(kbStagingDocsTable)
        .values({
          title: proposedTitle || docs[0].title,
          content: proposedContent,
          category: donor.category,
          status: "needs_review",
          homeRoot: donor.homeRoot,
          node: donor.node,
          docClassTarget: donor.docClassTarget,
          docType: donor.docType,
          audience: donor.audience,
          originType: "ai_synthesized",
          pendingMergeSourceIds: sourceIds,
        })
        .returning();

      await tx.insert(kbTriageAuditLogTable).values({
        stagingDocId: created.id,
        eventType: "ai_merge_draft_created",
        confidenceScore: null,
        actorUserId: userId,
        aiReasoning: `AI merge draft generated from drafts ${sourceIds.map((id) => `#${id}`).join(", ")}; sources stay in needs_review until the merge is confirmed.`,
        docTitle: created.title,
      });

      return created;
    });

    res.json({ draft, sourceIds });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Confirm a pending AI merge draft (Task #1902): fold every still-reviewable
// source draft into it (status -> merged, mergedIntoId -> draft) and clear the
// draft's pending marker. The draft itself stays in needs_review for normal
// approval. Conditional flips keep this idempotent / concurrent-safe.
router.post("/duplicates/confirm-merge", async (req: Request, res: Response) => {
  try {
    const { draftId } = req.body as { draftId?: number };
    if (!draftId || typeof draftId !== "number") {
      res.status(400).json({ error: "draftId is required" });
      return;
    }

    const [draft] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, draftId));
    if (!draft) {
      res.status(404).json({ error: "Merge draft not found" });
      return;
    }
    const sourceIds = Array.isArray(draft.pendingMergeSourceIds) ? draft.pendingMergeSourceIds : [];
    if (sourceIds.length === 0) {
      res.status(409).json({ error: "This document is not a pending AI merge draft" });
      return;
    }
    if (draft.status !== "needs_review") {
      res.status(409).json({ error: `Merge draft is no longer in needs_review (status: ${draft.status})` });
      return;
    }

    const userId = (req as unknown as { userId: number }).userId;

    // Sentinel to roll the transaction back when nothing actually merges —
    // the draft keeps its pending marker so the reviewer can discard it.
    const CONFIRM_NOOP = Symbol("confirm-noop");
    try {
      const result = await db.transaction(async (tx) => {
        const merged = await tx
          .update(kbStagingDocsTable)
          .set({ status: "merged", mergedIntoId: draftId })
          .where(
            and(
              inArray(kbStagingDocsTable.id, sourceIds),
              eq(kbStagingDocsTable.status, "needs_review"),
            ),
          )
          .returning({ id: kbStagingDocsTable.id, title: kbStagingDocsTable.title });

        if (merged.length === 0) throw CONFIRM_NOOP;

        const [updatedDraft] = await tx
          .update(kbStagingDocsTable)
          .set({ pendingMergeSourceIds: null })
          .where(eq(kbStagingDocsTable.id, draftId))
          .returning();

        for (const m of merged) {
          await tx.insert(kbTriageAuditLogTable).values({
            stagingDocId: m.id,
            eventType: "merged_duplicate",
            confidenceScore: null,
            actorUserId: userId,
            aiReasoning: `Merged into AI merge draft #${draftId} ("${draft.title}") via confirmed merge.`,
            docTitle: m.title,
          });
        }
        await tx.insert(kbTriageAuditLogTable).values({
          stagingDocId: draftId,
          eventType: "ai_merge_confirmed",
          confidenceScore: null,
          actorUserId: userId,
          aiReasoning: `Merge confirmed: drafts ${merged.map((m) => `#${m.id}`).join(", ")} folded into this AI merge draft.`,
          docTitle: draft.title,
        });

        return { updatedDraft, merged };
      });

      res.json({
        draft: result.updatedDraft,
        merged: result.merged.length,
        mergedIds: result.merged.map((m) => m.id),
        skipped: sourceIds.filter((id) => !result.merged.some((m) => m.id === id)),
      });
    } catch (txErr) {
      if (txErr === CONFIRM_NOOP) {
        res.status(409).json({ error: "None of the source drafts are still in needs_review — nothing to merge. Discard the draft if it's no longer wanted." });
        return;
      }
      throw txErr;
    }
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Discard a pending AI merge draft (Task #1902): soft-delete the draft
// (status -> 'deleted', same as the duplicates delete path so the triage audit
// trail survives) WITHOUT touching the source drafts — they were never folded
// in. Idempotent: an already-deleted draft is a soft success.
router.post("/duplicates/discard-merge", async (req: Request, res: Response) => {
  try {
    const { draftId } = req.body as { draftId?: number };
    if (!draftId || typeof draftId !== "number") {
      res.status(400).json({ error: "draftId is required" });
      return;
    }

    const [draft] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, draftId));
    if (!draft) {
      res.status(404).json({ error: "Merge draft not found" });
      return;
    }
    if (draft.status === "deleted") {
      res.json({ id: draftId, alreadyDiscarded: true });
      return;
    }
    const sourceIds = Array.isArray(draft.pendingMergeSourceIds) ? draft.pendingMergeSourceIds : [];
    if (sourceIds.length === 0) {
      res.status(409).json({ error: "This document is not a pending AI merge draft" });
      return;
    }

    const userId = (req as unknown as { userId: number }).userId;

    await db.transaction(async (tx) => {
      await tx
        .update(kbStagingDocsTable)
        .set({ status: "deleted", mergedIntoId: null, pendingMergeSourceIds: null })
        .where(eq(kbStagingDocsTable.id, draftId));

      await tx.insert(kbTriageAuditLogTable).values({
        stagingDocId: draftId,
        eventType: "ai_merge_draft_discarded",
        confidenceScore: null,
        actorUserId: userId,
        aiReasoning: `Pending AI merge draft discarded before confirmation; source drafts ${sourceIds.map((id) => `#${id}`).join(", ")} untouched.`,
        docTitle: draft.title,
      });
    });

    res.json({ id: draftId, discarded: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Permanently delete a single duplicate draft from the Possible Duplicates
// review page. Soft-delete (status -> 'deleted') rather than a row DROP so the
// triage audit trail — which FK-cascades on a hard row delete — survives; the
// draft is gone from every review surface (needs_review / merged lists never
// query 'deleted') and there is no restore path, so it does not reappear.
// Idempotent under a double-click: a doc already deleted is a soft success.
// The two-step confirmation guarding this lives in the UI.
router.delete("/duplicates/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "A valid numeric id is required" });
      return;
    }

    const [doc] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    if (doc.status === "deleted") {
      res.json({ id, alreadyDeleted: true });
      return;
    }
    // This surface only shows needs-review duplicate drafts. Refuse to delete an
    // already-approved/merged/rejected doc through here — those have their own
    // lifecycle (e.g. merged drafts are restored, not deleted) and reaching this
    // endpoint with one is a misuse, not a duplicate cleanup.
    if (doc.status !== "needs_review") {
      res.status(409).json({ error: `Only needs-review drafts can be deleted here (status: ${doc.status}).` });
      return;
    }

    const userId = (req as unknown as { userId: number }).userId;

    // Transaction: the status flip and its audit row land together or not at
    // all — never "deleted with no audit trail". The audit row survives because
    // this is a soft delete (the doc row itself is not removed).
    await db.transaction(async (tx) => {
      await tx
        .update(kbStagingDocsTable)
        .set({ status: "deleted", mergedIntoId: null })
        .where(eq(kbStagingDocsTable.id, id));

      await tx.insert(kbTriageAuditLogTable).values({
        stagingDocId: id,
        eventType: "deleted_duplicate",
        confidenceScore: null,
        actorUserId: userId,
        aiReasoning: `Permanently deleted from the Possible Duplicates review page (was status: ${doc.status}).`,
        docTitle: doc.title,
      });
    });

    res.json({ id, deleted: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Read a live doc alongside a draft (similar-live-doc side panel).
router.get("/live-doc/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const [doc] = await db
      .select({
        id: aiLiveDocumentsTable.id,
        title: aiLiveDocumentsTable.title,
        content: aiLiveDocumentsTable.content,
        docClass: aiLiveDocumentsTable.docClass,
        homeRoot: aiLiveDocumentsTable.homeRoot,
        node: aiLiveDocumentsTable.node,
        lastVerified: aiLiveDocumentsTable.lastVerified,
      })
      .from(aiLiveDocumentsTable)
      .where(and(eq(aiLiveDocumentsTable.id, id), sql`${aiLiveDocumentsTable.deletedAt} IS NULL`));
    if (!doc) {
      res.status(404).json({ error: "Live document not found" });
      return;
    }
    res.json(doc);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Per-document routes ───────────────────────────────────────────────────────

// ── "Not a name" dismissals (Task #1815) ─────────────────────────────────────
// Persistent reviewer loop for the possible_member_name advisory flag: a
// dismissed pair joins the derived name-flag vocabulary and never flags again
// on any doc. Registered BEFORE the /:id routes so the literal path wins.
router.get("/name-flag-dismissals", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(kbNameFlagDismissalsTable)
      .orderBy(desc(kbNameFlagDismissalsTable.createdAt));
    res.json({ dismissals: rows });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/name-flag-dismissals", async (req: Request, res: Response) => {
  try {
    const raw = typeof req.body?.pair === "string" ? req.body.pair.trim() : "";
    // Must be exactly the analyzer's capitalized First Last shape.
    if (!/^[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}$/.test(raw)) {
      res.status(400).json({ error: "Dismissal must be an exact 'First Last' pair as flagged." });
      return;
    }
    // SAFETY RAIL: privacy-rule matches (coach/staff surnames, founder, old
    // brand) can never be dismissed — the deterministic scrub always wins.
    if (isPrivacyProtectedPair(raw)) {
      res.status(400).json({ error: "This pair matches the privacy scrub rules and cannot be dismissed." });
      return;
    }
    const pair = raw.toLowerCase().replace(/\s+/g, " ");
    await db
      .insert(kbNameFlagDismissalsTable)
      .values({ pair, displayPair: raw.replace(/\s+/g, " "), dismissedBy: req.userId ?? null })
      .onConflictDoNothing({ target: kbNameFlagDismissalsTable.pair });
    invalidateNameFlagVocab();
    res.json({ ok: true, pair });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.delete("/name-flag-dismissals/:dismissalId", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.dismissalId));
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    await db.delete(kbNameFlagDismissalsTable).where(eq(kbNameFlagDismissalsTable.id, id));
    invalidateNameFlagVocab();
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Reviewer SOP (Task #1851) — the in-app "how to review a draft" reference,
// derived from the live taxonomy + flag registries so it can't drift. Static
// (no DB); registered before "/:id" so the literal path wins.
router.get("/reviewer-sop", async (_req: Request, res: Response) => {
  try {
    res.json(buildReviewerSop());
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Controlled tag vocabulary for the reviewer's grouped multi-select (Task
// #1865): Concept / Tool / Troubleshooting families. Registered before "/:id"
// so the literal path wins. The tool family is DB-managed (enabled set);
// concept + troubleshooting are the fixed code baseline.
router.get("/tag-vocabulary", async (_req: Request, res: Response) => {
  try {
    res.json(getEffectiveTagGroups());
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Passage-highlight dismissals (Task #1906) ────────────────────────────────
// Persistent "Ignore" for review-insight highlights. Keyed on (kind +
// normalized excerpt) — GLOBAL across drafts, so a dismissal survives
// re-synthesis reproducing the identical passage. Registered BEFORE the /:id
// routes so the literal path wins.
router.get("/highlight-dismissals", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(kbHighlightDismissalsTable)
      .orderBy(desc(kbHighlightDismissalsTable.createdAt));
    res.json({ dismissals: rows });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/highlight-dismissals", async (req: Request, res: Response) => {
  try {
    const { kind, excerpt, docId, reason } = req.body as {
      kind?: unknown;
      excerpt?: unknown;
      docId?: unknown;
      reason?: unknown;
    };
    const kindStr = typeof kind === "string" ? kind.trim() : "";
    if (!(kindStr in HIGHLIGHT_META)) {
      res.status(400).json({ error: "Unknown highlight kind" });
      return;
    }
    const excerptStr = typeof excerpt === "string" ? excerpt.trim() : "";
    if (!excerptStr) {
      res.status(400).json({ error: "An excerpt is required" });
      return;
    }
    // SAFETY RAIL: name highlights have their own "Not a name" vocabulary path
    // with privacy-protected-pair checks — never dismissible through here.
    if (kindStr === "possible_member_name") {
      res.status(400).json({ error: "Use the 'Not a name' dismissal for name highlights." });
      return;
    }
    const docIdNum = typeof docId === "number" ? docId : Number(docId);

    // The dismissal must correspond to a highlight that ACTUALLY exists on the
    // doc's current text — a stale UI can never seed a phantom suppression.
    let docTitle: string | null = null;
    if (Number.isFinite(docIdNum)) {
      const [doc] = await db
        .select()
        .from(kbStagingDocsTable)
        .where(eq(kbStagingDocsTable.id, docIdNum));
      if (!doc) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      docTitle = doc.title;
      const highlights = analyzeDraftForReview(
        doc.editedContent ?? doc.content,
        await getNameFlagVocab(),
      );
      const norm = normalizeExcerpt(excerptStr);
      const match = highlights.some(
        (h) => h.kind === kindStr && normalizeExcerpt(h.excerpt) === norm,
      );
      if (!match) {
        res.status(409).json({ error: "That passage is no longer flagged on this document — refresh and try again." });
        return;
      }
    } else {
      res.status(400).json({ error: "docId is required" });
      return;
    }

    const [row] = await db
      .insert(kbHighlightDismissalsTable)
      .values({
        kind: kindStr,
        excerptNorm: normalizeExcerpt(excerptStr),
        displayExcerpt: excerptStr,
        stagingDocId: docIdNum,
        dismissedBy: req.userId ?? null,
        reason: typeof reason === "string" && reason.trim() ? reason.trim().substring(0, 500) : null,
      })
      .onConflictDoNothing({
        target: [kbHighlightDismissalsTable.kind, kbHighlightDismissalsTable.excerptNorm],
      })
      .returning();

    await db.insert(kbTriageAuditLogTable).values({
      stagingDocId: docIdNum,
      eventType: "highlight_dismissed",
      confidenceScore: null,
      actorUserId: req.userId ?? null,
      aiReasoning: `Reviewer ignored ${HIGHLIGHT_META[kindStr as ReviewHighlightKind].label} highlight: "${excerptStr.substring(0, 200)}"${typeof reason === "string" && reason.trim() ? ` — ${reason.trim().substring(0, 300)}` : ""} (suppressed for this passage everywhere, survives re-synthesis)`,
      docTitle,
    });

    res.json({ ok: true, dismissal: row ?? null });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.delete("/highlight-dismissals/:dismissalId", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.dismissalId));
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [removed] = await db
      .delete(kbHighlightDismissalsTable)
      .where(eq(kbHighlightDismissalsTable.id, id))
      .returning();
    // Audit needs a doc to hang the event on; a dismissal created without a
    // doc context (stagingDocId null) is still removed, just not audited.
    if (removed && removed.stagingDocId != null) {
      await db.insert(kbTriageAuditLogTable).values({
        stagingDocId: removed.stagingDocId,
        eventType: "highlight_dismissal_undone",
        confidenceScore: null,
        actorUserId: req.userId ?? null,
        aiReasoning: `Reviewer removed the highlight dismissal for "${removed.displayExcerpt.substring(0, 200)}" (${removed.kind}) — the passage will flag again on future analyses.`,
        docTitle: null,
      });
    }
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const [doc] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, id));

    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    res.json(doc);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── Doc-level flag resolutions (Task #1906) ──────────────────────────────────
// Resolve/Ignore a stored risk flag with an audit trail. The resolution is
// pinned to the flag's fingerprint (message+detail), so deterministic re-triage
// reproducing the SAME flag keeps it resolved, while a new trigger resurfaces.
// Resolving every critical flag clears needs_expert.
router.post("/:id/flags/resolve", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const { flagType, reason } = req.body as { flagType?: unknown; reason?: unknown };
    const typeStr = typeof flagType === "string" ? flagType.trim() : "";
    if (!(RISK_FLAG_TYPES as readonly string[]).includes(typeStr)) {
      res.status(400).json({ error: "Unknown flag type" });
      return;
    }
    const [doc] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const flags = Array.isArray(doc.riskFlags) ? (doc.riskFlags as RiskFlag[]) : [];
    const flag = flags.find((f) => f.type === typeStr);
    if (!flag) {
      res.status(409).json({ error: "That flag is not present on this document — refresh and try again." });
      return;
    }

    const userId = (req as unknown as { userId: number }).userId;
    const reasonStr = typeof reason === "string" && reason.trim() ? reason.trim().substring(0, 1000) : null;
    const fingerprint = flagFingerprint(flag);
    await db
      .insert(kbFlagResolutionsTable)
      .values({
        stagingDocId: id,
        flagType: typeStr,
        fingerprint,
        resolvedBy: userId,
        reason: reasonStr,
      })
      .onConflictDoUpdate({
        target: [kbFlagResolutionsTable.stagingDocId, kbFlagResolutionsTable.flagType],
        set: { fingerprint, resolvedBy: userId, reason: reasonStr, createdAt: new Date() },
      });

    await db.insert(kbTriageAuditLogTable).values({
      stagingDocId: id,
      eventType: "flag_resolved",
      confidenceScore: null,
      actorUserId: userId,
      aiReasoning: `Reviewer resolved the "${typeStr}" flag (${flag.severity}): ${flag.message}${reasonStr ? ` — reason: ${reasonStr}` : ""}`,
      docTitle: doc.title,
    });

    const needsExpert = await recomputeNeedsExpert(id);
    const outstanding = await getDocOutstanding(doc);
    res.json({ ok: true, needsExpert, flagStates: outstanding.flagStates });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/:id/flags/unresolve", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const { flagType } = req.body as { flagType?: unknown };
    const typeStr = typeof flagType === "string" ? flagType.trim() : "";
    if (!typeStr) {
      res.status(400).json({ error: "flagType is required" });
      return;
    }
    const [doc] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const [removed] = await db
      .delete(kbFlagResolutionsTable)
      .where(
        and(
          eq(kbFlagResolutionsTable.stagingDocId, id),
          eq(kbFlagResolutionsTable.flagType, typeStr),
        ),
      )
      .returning();
    if (removed) {
      await db.insert(kbTriageAuditLogTable).values({
        stagingDocId: id,
        eventType: "flag_resolution_undone",
        confidenceScore: null,
        actorUserId: req.userId ?? null,
        aiReasoning: `Reviewer reopened the "${typeStr}" flag — it counts against approval again.`,
        docTitle: doc.title,
      });
    }
    const needsExpert = await recomputeNeedsExpert(id);
    const outstanding = await getDocOutstanding(doc);
    res.json({ ok: true, needsExpert, flagStates: outstanding.flagStates });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const {
      status,
      adminNotes,
      editedContent,
      title,
      category,
      tags,
      taxonomyTags,
      homeRoot,
      node,
      docClassTarget,
      ceiling,
      needsExpert,
      navApp,
      navArea,
    } = req.body;

    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (adminNotes !== undefined) updates.adminNotes = adminNotes;
    if (editedContent !== undefined) updates.editedContent = editedContent;
    // Human title edit (Task #1865): records the decision as "edited" and
    // re-scores the stored retrieval self-test against the new title after the
    // update (retrieval only, no LLM). This does NOT lock the suggestion —
    // analysis always re-proposes a fresh one and clears the decision.
    let titleEdited = false;
    if (title) {
      updates.title = title;
      const [existing] = await db
        .select({ title: kbStagingDocsTable.title })
        .from(kbStagingDocsTable)
        .where(eq(kbStagingDocsTable.id, id));
      if (existing && existing.title !== title) {
        updates.aiTitleDecision = "edited";
        titleEdited = true;
      }
    }
    if (category) updates.category = category;
    if (tags !== undefined) updates.tags = tags;
    // Controlled taxonomy tags (Task #1865): the reviewer's grouped multi-select
    // writes taxonomyTags (jsonb), NOT the legacy free-text `tags` column.
    if (taxonomyTags !== undefined) {
      updates.taxonomyTags = Array.isArray(taxonomyTags)
        ? taxonomyTags.filter((t: unknown): t is string => typeof t === "string")
        : [];
    }
    // Taxonomy fields the editor sends — previously dropped on the floor, so
    // reviewer edits to shelf / node / doc-class never persisted.
    if (homeRoot !== undefined) updates.homeRoot = homeRoot || null;
    if (node !== undefined) updates.node = node || null;
    if (docClassTarget !== undefined) updates.docClassTarget = docClassTarget || null;
    if (ceiling !== undefined) updates.ceiling = ceiling || null;
    if (needsExpert !== undefined) updates.needsExpert = needsExpert;
    if (navApp !== undefined) updates.navApp = navApp || null;
    if (navArea !== undefined) updates.navArea = navArea || null;

    if (status === "approved" || status === "rejected" || status === "needs_review") {
      updates.reviewedBy = (req as unknown as { userId: number }).userId;
      updates.reviewedAt = new Date();
    }

    // Approval gate (Task #1906): the TRANSITION to approved is blocked while
    // unresolved risk flags or passage highlights remain — the reviewer must
    // fix, resolve, or ignore each first. Docs ALREADY approved are untouched
    // (they stay publishable); judged against the text about to be saved.
    if (status === "approved") {
      const [existingDoc] = await db
        .select()
        .from(kbStagingDocsTable)
        .where(eq(kbStagingDocsTable.id, id));
      if (!existingDoc) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      if (FLAG_APPROVAL_GATE_ENABLED && existingDoc.status !== "approved") {
        const outstanding = await getDocOutstanding(
          existingDoc,
          editedContent !== undefined ? (editedContent ?? existingDoc.content) : undefined,
        );
        if (outstanding.activeFlags.length > 0 || outstanding.activeHighlights.length > 0) {
          res.status(409).json({
            error: "Unresolved flags or flagged passages remain — resolve, ignore, or fix each before approving.",
            outstanding: {
              flags: outstanding.activeFlags,
              highlights: outstanding.activeHighlights,
            },
          });
          return;
        }
      }
    }

    const [updated] = await db
      .update(kbStagingDocsTable)
      .set(updates)
      .where(eq(kbStagingDocsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    // Deterministic re-triage (Task #1906): a content edit recomputes the
    // stored risk flags from the NEW text (same pure rules as AI triage, no
    // LLM) — a fixed trigger clears its flag; a resolved-but-unchanged flag is
    // NOT resurrected (its fingerprint still matches the resolution).
    if (editedContent !== undefined) {
      await retriageDocFlags(id);
      if (!titleEdited) {
        const [retriaged] = await db
          .select()
          .from(kbStagingDocsTable)
          .where(eq(kbStagingDocsTable.id, id));
        res.json(retriaged ?? updated);
        return;
      }
    }

    if (titleEdited) {
      await rescoreSelfTestForTitle(updated, updated.title);
      const [rescored] = await db
        .select()
        .from(kbStagingDocsTable)
        .where(eq(kbStagingDocsTable.id, id));
      res.json(rescored ?? updated);
      return;
    }

    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.post("/bulk-approve", async (req: Request, res: Response) => {
  try {
    const { ids } = req.body as { ids: number[] };
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids array required" });
      return;
    }

    const userId = (req as unknown as { userId: number }).userId;
    let approved = 0;
    const blocked: number[] = [];

    for (const id of ids) {
      // Bulk-confirm is gated: a doc carrying a conflict / high-stakes (blocking)
      // risk flag must be opened and adjudicated one-by-one, never rubber-stamped.
      // Task #1906: additionally, ANY unresolved flag or un-dismissed passage
      // highlight blocks — same rule as the single-doc approval transition.
      const [doc] = await db
        .select()
        .from(kbStagingDocsTable)
        .where(eq(kbStagingDocsTable.id, id));
      if (!doc) continue;
      // TEMPORARY (Task #1934): bulk-confirm gates disabled while flags are
      // hidden in the review dialog — see FLAG_APPROVAL_GATE_ENABLED.
      if (FLAG_APPROVAL_GATE_ENABLED) {
        if (doc.needsExpert || blocksBulkConfirm((doc.riskFlags ?? []) as RiskFlag[])) {
          blocked.push(id);
          continue;
        }
        const outstanding = await getDocOutstanding(doc);
        if (outstanding.activeFlags.length > 0 || outstanding.activeHighlights.length > 0) {
          blocked.push(id);
          continue;
        }
      }

      const [updated] = await db
        .update(kbStagingDocsTable)
        .set({
          status: "approved",
          reviewedBy: userId,
          reviewedAt: new Date(),
        })
        .where(
          and(
            eq(kbStagingDocsTable.id, id),
            eq(kbStagingDocsTable.status, "needs_review"),
          ),
        )
        .returning();
      if (updated) approved++;
    }

    res.json({ approved, total: ids.length, blocked: blocked.length, blockedIds: blocked });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.post("/merge", async (req: Request, res: Response) => {
  try {
    const { ids } = req.body as { ids: number[] };
    if (!ids || ids.length < 2) {
      res.status(400).json({ error: "At least 2 document ids required" });
      return;
    }

    const docs = await db
      .select()
      .from(kbStagingDocsTable)
      .where(sql`${kbStagingDocsTable.id} = ANY(${ids})`);

    if (docs.length < 2) {
      res.status(400).json({ error: "Not enough documents found" });
      return;
    }

    const mergePrompt = `You are merging multiple training documents that cover overlapping topics into ONE comprehensive document. Combine the best content from all sources:
- Keep the clearest explanations
- Combine unique examples from different sources
- Preserve all actionable steps (union, not intersection)
- Remove redundant content
- Maintain headings, structure, numbered steps
- Keep BTS branding. Never reference TCE, Cherrington, or Adam.
- Target 400-1000 words

OUTPUT FORMAT:
# [Merged Document Title]

**Category:** [curriculum | strategy | sop | faq | platform_guide]
**Topics:** [comma-separated tags]

[Structured content with ## headings]

## Key Takeaways
- [bullets]`;

    const docContents = docs
      .map(
        (d, i) =>
          `=== DOCUMENT ${i + 1}: ${d.title} ===\n${d.editedContent || d.content}`,
      )
      .join("\n\n");

    const resp = await fetch(
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL + "/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization:
            "Bearer " + process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5",
          messages: [
            { role: "system", content: mergePrompt },
            { role: "user", content: docContents },
          ],
          max_completion_tokens: 2500,
        }),
        signal: AbortSignal.timeout(60000),
      },
    );

    if (!resp.ok) {
      throw new Error("AI merge failed: " + resp.status);
    }

    const json = (await resp.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const mergedContent = json.choices[0]?.message?.content || "";

    const titleMatch = mergedContent.match(/^#\s+(.+)/m);
    const categoryMatch = mergedContent.match(/\*\*Category:\*\*\s*(\w+)/);
    const topicsMatch = mergedContent.match(/\*\*Topics:\*\*\s*(.+)/);

    const allTags = docs.map((d) => d.tags).join(", ");
    const allSources = docs
      .map((d) => d.sourceVideoTitle)
      .filter(Boolean)
      .join("; ");

    const [merged] = await db
      .insert(kbStagingDocsTable)
      .values({
        title: titleMatch ? titleMatch[1].trim() : "Merged: " + docs[0].title,
        category: categoryMatch ? categoryMatch[1].trim() : docs[0].category,
        content: mergedContent,
        tags: topicsMatch ? topicsMatch[1].trim() : allTags,
        sourceVideoTitle: allSources,
        status: "needs_review",
      })
      .returning();

    for (const doc of docs) {
      await db
        .update(kbStagingDocsTable)
        .set({
          status: "merged",
          mergedIntoId: merged.id,
        })
        .where(eq(kbStagingDocsTable.id, doc.id));
    }

    res.json({ merged, sourceDocIds: ids });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.post("/push-approved", async (_req: Request, res: Response) => {
  try {
    const newlyApproved = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.status, "approved"));

    if (newlyApproved.length === 0) {
      const [{ cnt: totalInLiveKb }] = await db
        .select({ cnt: count() })
        .from(aiLiveDocumentsTable);
      res.json({
        message: "No approved documents to push",
        pushed: 0,
        totalInLiveKb,
      });
      return;
    }

    // Navigation docs published in this push — used to auto-resolve matching
    // open nav-gap flags AFTER the transaction commits (best-effort).
    const publishedNavDocs: Array<{ id: number; navApp: string | null; navArea: string | null }> = [];
    // Live doc ids created/updated in this push — embedded post-commit.
    const publishedLiveDocIds: number[] = [];

    await db.transaction(async (tx) => {
      for (const doc of newlyApproved) {
        const content = scrubPrivateContent(doc.editedContent ?? doc.content);

        // Resolve the published taxonomy. A published (citable) doc MUST carry a
        // citable doc_class + last_verified — that is the human gate the citable
        // filter enforces. The reviewer sets docClassTarget; fall back to the
        // safer 'curated' class only when it is missing.
        const docClass = doc.docClassTarget && CITABLE_DOC_CLASSES.includes(doc.docClassTarget as (typeof CITABLE_DOC_CLASSES)[number])
          ? doc.docClassTarget
          : "curated";
        const tags = Array.isArray(doc.taxonomyTags) ? doc.taxonomyTags : [];

        // ── Update path (Synthesis Engine Part 3) ─────────────────────────────
        // A draft that targets an existing published Live AI Document supersedes
        // it IN PLACE: snapshot the prior published version (content + provenance)
        // into ai_live_document_versions, then overwrite the SAME row and re-stamp
        // last_verified. No orphan duplicate; version history preserved; the
        // assistant keeps citing the one live row. If the target has since been
        // deleted, we fall through to the create/upsert path.
        let live: { id: number } | undefined;
        if (doc.updateKind === "update" && doc.targetLiveDocId) {
          const [target] = await tx
            .select()
            .from(aiLiveDocumentsTable)
            .where(eq(aiLiveDocumentsTable.id, doc.targetLiveDocId));

          if (target) {
            const [{ cnt: priorVersions }] = await tx
              .select({ cnt: count() })
              .from(aiLiveDocumentVersionsTable)
              .where(eq(aiLiveDocumentVersionsTable.docId, target.id));

            const priorProvenance = await tx
              .select({
                sourceId: kbDocProvenanceTable.sourceId,
                chunkRef: kbDocProvenanceTable.chunkRef,
                relation: kbDocProvenanceTable.relation,
              })
              .from(kbDocProvenanceTable)
              .where(eq(kbDocProvenanceTable.docId, target.id));

            await tx.insert(aiLiveDocumentVersionsTable).values({
              docId: target.id,
              versionNumber: priorVersions + 1,
              title: target.title,
              content: target.content,
              docClass: target.docClass,
              homeRoot: target.homeRoot,
              node: target.node,
              lastVerified: target.lastVerified,
              provenance: priorProvenance,
              supersededByStagingDocId: doc.id,
            });

            await tx
              .update(aiLiveDocumentsTable)
              .set({
                title: scrubPrivateContent(doc.title),
                // Retrieval scope is driven by the doc's Shelf (home root), not
                // the legacy staging Category (Task #1865). category holds the
                // home-root slug so retrieval (which scopes on category) works.
                category: resolveHomeRoot(doc.homeRoot),
                content,
                audience: doc.audience ?? "member",
                docClass,
                homeRoot: doc.homeRoot,
                node: doc.node,
                tags,
                blitzSection: doc.blitzSection,
                ceiling: doc.ceiling,
                handoff: doc.handoff,
                navApp: doc.navApp,
                navArea: doc.navArea,
                lastVerified: sql`NOW()`,
                updatedAt: sql`NOW()`,
                // An approved revision resolves any "source changed" stale flag.
                flaggedStaleAt: null,
                flaggedReason: null,
                // Content changed → clear the semantic vector ATOMICALLY so a
                // failed post-commit re-embed degrades to lexical-only, never stale.
                ...CLEARED_EMBEDDING_FIELDS,
              })
              .where(eq(aiLiveDocumentsTable.id, target.id));

            live = { id: target.id };
          }
        }

        // Create / upsert path (new docs, or an update whose target vanished).
        if (!live) {
          const [inserted] = await tx
            .insert(aiLiveDocumentsTable)
            .values({
              title: scrubPrivateContent(doc.title),
              // Retrieval scope driven by Shelf (home root), not legacy Category
              // (Task #1865). onConflictDoUpdate mirrors this via EXCLUDED.category.
              category: resolveHomeRoot(doc.homeRoot),
              content,
              audience: doc.audience ?? "member",
              docClass,
              homeRoot: doc.homeRoot,
              node: doc.node,
              tags,
              blitzSection: doc.blitzSection,
              ceiling: doc.ceiling,
              handoff: doc.handoff,
              navApp: doc.navApp,
              navArea: doc.navArea,
              lastVerified: sql`NOW()`,
            })
            .onConflictDoUpdate({
              target: aiLiveDocumentsTable.title,
              set: {
                category: sql`EXCLUDED.category`,
                content: sql`EXCLUDED.content`,
                audience: sql`EXCLUDED.audience`,
                docClass: sql`EXCLUDED.doc_class`,
                homeRoot: sql`EXCLUDED.home_root`,
                node: sql`EXCLUDED.node`,
                tags: sql`EXCLUDED.tags`,
                blitzSection: sql`EXCLUDED.blitz_section`,
                ceiling: sql`EXCLUDED.ceiling`,
                handoff: sql`EXCLUDED.handoff`,
                navApp: sql`EXCLUDED.nav_app`,
                navArea: sql`EXCLUDED.nav_area`,
                lastVerified: sql`NOW()`,
                updatedAt: sql`NOW()`,
                // Upsert overwrites content → clear the semantic vector atomically.
                ...CLEARED_EMBEDDING_FIELDS,
              },
            })
            .returning({ id: aiLiveDocumentsTable.id });
          live = inserted;
        }

        // Provenance: trace the published claim back to its screened source(s).
        // We refresh it on each push so re-publishing keeps an accurate set.
        //
        // Synthesized truth-docs consolidate MANY sources, so we write one row
        // per contributing source from synthesisSources (multi-source
        // provenance). Legacy single-source drafts keep the one-row behavior.
        if (live) {
          await tx.delete(kbDocProvenanceTable).where(eq(kbDocProvenanceTable.docId, live.id));

          const synthSources = Array.isArray(doc.synthesisSources)
            ? (doc.synthesisSources as Array<{
                sourceName?: string | null;
                transcriptSourceId?: number | null;
                relevance?: number | null;
              }>)
            : [];

          if (synthSources.length > 0) {
            await tx.insert(kbDocProvenanceTable).values(
              synthSources.map((s) => ({
                docId: live.id,
                sourceId: s.transcriptSourceId ?? null,
                chunkRef: s.sourceName ?? null,
                relation: "source",
              })),
            );
          } else {
            await tx.insert(kbDocProvenanceTable).values({
              docId: live.id,
              sourceId: doc.sourceId ?? null,
              chunkRef: doc.sourceVideoTitle ?? null,
              relation: "source",
            });
          }
        }

        await tx
          .update(kbStagingDocsTable)
          .set({ status: "published" })
          .where(eq(kbStagingDocsTable.id, doc.id));

        if (docClass === "navigation" && live && doc.navApp) {
          publishedNavDocs.push({ id: live.id, navApp: doc.navApp, navArea: doc.navArea });
        }
        if (live) publishedLiveDocIds.push(live.id);
      }
    });

    // Semantic embeddings (Task #1803): (re)embed every doc this push touched.
    // Post-commit + fire-and-forget: an embedding failure never fails the push;
    // the doc stays lexical-only until the boot backfill retries it.
    for (const liveDocId of publishedLiveDocIds) {
      embedLiveDocumentInBackground(liveDocId);
    }

    // Auto-resolve open nav-gap flags covered by the just-published nav docs.
    // Best-effort: a failure here never fails the push itself.
    for (const navDoc of publishedNavDocs) {
      try {
        await resolveNavGapsForPublishedDoc(navDoc);
      } catch (err) {
        console.error("[KB Push] nav-gap auto-resolve failed:", err instanceof Error ? err.message : err);
      }
    }

    const [{ cnt: totalInLiveKb }] = await db
      .select({ cnt: count() })
      .from(aiLiveDocumentsTable);

    res.json({
      message: `Pushed ${newlyApproved.length} documents to live knowledge base`,
      pushed: newlyApproved.length,
      totalInLiveKb,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[KB Push] Error:", message, err);
    res.status(500).json({ error: message });
  }
});

router.get("/:id/similar", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const [doc] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, id));

    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const keywords = doc.title
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);
    const searchQuery = keywords.join(" | ");

    const similar = await db
      .select({
        id: kbStagingDocsTable.id,
        title: kbStagingDocsTable.title,
        category: kbStagingDocsTable.category,
        status: kbStagingDocsTable.status,
        tags: kbStagingDocsTable.tags,
      })
      .from(kbStagingDocsTable)
      .where(
        and(
          ne(kbStagingDocsTable.id, id),
          ne(kbStagingDocsTable.status, "merged"),
          ne(kbStagingDocsTable.status, "rejected"),
          sql`to_tsvector('english', ${kbStagingDocsTable.title} || ' ' || ${kbStagingDocsTable.content}) @@ to_tsquery('english', ${searchQuery})`,
        ),
      )
      .limit(10);

    res.json(similar);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.post("/:id/undo-auto-action", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const [doc] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const userId = (req as unknown as { userId: number }).userId;
    await undoAutoAction(doc, userId);
    res.json({ success: true, message: "Auto-action undone. Document moved to needs_review." });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Instruct-the-AI redraft (Task #2, step 9) ────────────────────────────────
//
// The reviewer types a plain-language instruction ("tighten the intro", "remove
// the pricing claim", "add a steps section") and the AI rewrites the current
// draft accordingly. The result is parked in editedContent for human review —
// status stays needs_review (never auto-published), legacy refs are re-detected,
// and the redraft is recorded in the audit log.
router.post("/:id/redraft", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const { instruction } = req.body as { instruction?: string };

    if (!instruction || !instruction.trim()) {
      res.status(400).json({ error: "An instruction is required" });
      return;
    }

    const [doc] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const current = doc.editedContent ?? doc.content;
    const systemPrompt = `You are revising a BTS (Build Test Scale) knowledge-base draft per a reviewer's instruction.
Apply ONLY the requested change. Preserve correct facts, headings and structure otherwise.
BRAND RULES: say "Build Test Scale" / "BTS" (never "TCE" or "Cherrington"); no coach surnames; support email is support@buildtestscale.com.
Return ONLY the full revised document body (markdown). No preamble, no explanation.`;

    const resp = await fetch(
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL + "/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `INSTRUCTION: ${instruction.trim()}\n\nTITLE: ${doc.title}\n\nCURRENT DRAFT:\n${current.substring(0, 8000)}`,
            },
          ],
          max_completion_tokens: 3000,
        }),
        signal: AbortSignal.timeout(60000),
      },
    );

    if (!resp.ok) {
      throw new Error("AI redraft failed: " + resp.status);
    }

    const json = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
    const revised = (json.choices[0]?.message?.content ?? "").trim();
    if (!revised) {
      throw new Error("AI returned an empty redraft");
    }

    const userId = (req as unknown as { userId: number }).userId;

    const [updated] = await db
      .update(kbStagingDocsTable)
      .set({ editedContent: revised, status: "needs_review" })
      .where(eq(kbStagingDocsTable.id, id))
      .returning();

    await db.insert(kbTriageAuditLogTable).values({
      stagingDocId: id,
      eventType: "redrafted",
      confidenceScore: null,
      actorUserId: userId,
      aiReasoning: `Redrafted per instruction: ${instruction.trim().substring(0, 300)}`,
      docTitle: doc.title,
    });

    res.json({ document: updated, instruction: instruction.trim() });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Corpus-aware refine chat (Task #1533) ────────────────────────────────────
//
// A THREADED, patch-based refinement conversation for synthesized truth-doc
// drafts. Unlike /redraft (single full-rewrite instruction), refine is aware of
// the draft's multi-source provenance (synthesisSources) and prior turns, and
// prefers surgical find/replace edits — a full rewrite is only the fallback when
// the edits can't be applied unambiguously (LLM latency scales with output
// tokens, so small patches keep the loop responsive). Result is parked in
// editedContent; status stays needs_review (never auto-published). Each turn is
// recorded in the audit log so the thread persists across sessions.
router.post("/:id/refine", async (req: Request, res: Response) => {
  // Long-run safety (Task #1903): the refine LLM work can outlive the HTTP
  // connection (budget-escalation retries run minutes; the browser/proxy may
  // abort first). Express keeps executing this handler after an abort, and
  // every outcome — success OR failure — is persisted to the refine thread
  // (kb_triage_audit_log) BEFORE responding, so the review page can poll the
  // thread and pick the result up without the reviewer resubmitting. These
  // outer-scope captures let the catch block persist a FAILED turn too.
  let failCtx: { docId: number; docTitle: string; userId: number | null; instruction: string } | null = null;
  try {
    const id = parseInt(getParam(req.params.id));
    const { instruction, history } = req.body as {
      instruction?: string;
      history?: Array<{ role: string; content: string }>;
    };

    if (!instruction || !instruction.trim()) {
      res.status(400).json({ error: "An instruction is required" });
      return;
    }

    const [doc] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    failCtx = {
      docId: id,
      docTitle: doc.title,
      userId: (req as unknown as { userId?: number }).userId ?? null,
      instruction: instruction.trim(),
    };

    const current = doc.editedContent ?? doc.content;

    // Corpus context: the sources this truth-doc consolidates, strongest first.
    const synthSources = Array.isArray(doc.synthesisSources)
      ? (doc.synthesisSources as Array<{
          sourceDocId?: number | null;
          sourceName?: string | null;
          authorityRole?: string | null;
          relevance?: number | null;
        }>)
      : [];

    // Corpus lookback: pull the ACTUAL content of the contributing source
    // documents so refine can reach back into the node's source material (not
    // just reshuffle the existing draft text). Strongest sources first, budget-
    // bounded so the loop stays responsive.
    const topSourceIds = synthSources
      .slice()
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
      .map((s) => s.sourceDocId)
      .filter((v): v is number => typeof v === "number")
      .slice(0, 6);

    let sourceMaterial = "";
    if (topSourceIds.length > 0) {
      const sourceRows = await db
        .select({
          id: aiSourceDocumentsTable.id,
          sourceName: aiSourceDocumentsTable.sourceName,
          content: aiSourceDocumentsTable.content,
        })
        .from(aiSourceDocumentsTable)
        .where(inArray(aiSourceDocumentsTable.id, topSourceIds));
      // Screened calls: reach back into the kept-segments representation, not
      // the raw transcript (raw fallback when no valid screening exists).
      // Duplicate-screened sources are excluded — the original carries the content.
      const resolvedRows = (
        await Promise.all(
          sourceRows.map(async (r) => {
            const resolved = await resolveSourceContentForSynthesis(r.id, r.content);
            return resolved.excluded ? null : { ...r, content: resolved.content };
          }),
        )
      ).filter((r): r is NonNullable<typeof r> => r !== null);
      const byId = new Map(resolvedRows.map((r) => [r.id, r]));
      const PER_SOURCE_CHARS = Math.floor(24000 / Math.max(resolvedRows.length, 1));
      sourceMaterial = topSourceIds
        .map((sid, i) => {
          const row = byId.get(sid);
          if (!row) return null;
          return `[SOURCE ${i + 1}] ${row.sourceName ?? "unnamed"}\n${scrubPrivateContent(row.content).substring(0, PER_SOURCE_CHARS)}`;
        })
        .filter(Boolean)
        .join("\n\n");
    }

    const sourceContext =
      synthSources.length > 0
        ? "This is a SYNTHESIZED truth document consolidating these sources (strongest first):\n" +
          synthSources
            .slice(0, 20)
            .map(
              (s, i) =>
                `${i + 1}. ${s.sourceName ?? "unnamed source"}${s.authorityRole ? ` [${s.authorityRole}]` : ""}`,
            )
            .join("\n")
        : "This draft was authored from a single source.";

    const priorTurns = (history ?? [])
      .slice(-6)
      .map((t) => `${t.role === "user" ? "Reviewer" : "Assistant"}: ${t.content}`)
      .join("\n");

    // Flag lifecycle context (Task #1906): the doc's ACTIVE flags + highlights,
    // numbered, so the chat can (a) be honest about what editing can and cannot
    // clear, and (b) map an explicit "ignore that flag" ask onto a real target.
    const lifecycle = await getDocOutstanding(doc);
    const flagLines = lifecycle.activeFlags.map(
      (f, i) => `F${i + 1}. type="${f.type}" (${f.severity}): ${f.message}`,
    );
    const highlightLines = lifecycle.activeHighlights.map(
      (h, i) => `H${i + 1}. kind="${h.kind}" excerpt="${h.excerpt}"`,
    );
    const flagContext =
      flagLines.length || highlightLines.length
        ? `CURRENT REVIEW FLAGS on this draft (unresolved):\n${[...flagLines, ...highlightLines].join("\n")}`
        : "CURRENT REVIEW FLAGS on this draft: none — nothing is currently blocking approval.";

    // Placement context (Task #1851): the draft's FILED shelf / node / doc-class
    // charter, so the refine chat can push back on edits that would drag content
    // outside where this doc belongs. Derived from the live taxonomy registry.
    const sop = buildReviewerSop();
    const filedDocClass = (doc.docClassTarget ?? "").trim();
    const dcInfo = sop.docClasses.find((c) => c.slug === filedDocClass) ?? null;
    const rootInfo = doc.homeRoot ? sop.homeRoots.find((r) => r.slug === doc.homeRoot) ?? null : null;
    const nodeInfo = getNodeBySlug(doc.node);
    const hasPlacement = !!(rootInfo || nodeInfo || dcInfo);
    const placementContext = hasPlacement
      ? `FILED PLACEMENT — where this draft currently lives. Respect it unless the reviewer explicitly re-files the doc:
- Shelf (home root): ${rootInfo ? `${rootInfo.label} — ${rootInfo.description}` : doc.homeRoot || "unassigned"}
- Node: ${nodeInfo ? nodeInfo.label : doc.node || "unassigned"}
- Doc class: ${dcInfo ? `${dcInfo.label}${dcInfo.citable ? " (citable)" : " (non-citable)"} — ${dcInfo.charter}` : filedDocClass || "unset"}`
      : "FILED PLACEMENT: this draft has no shelf / node / doc class assigned yet.";

    const systemPrompt = `You are refining a BTS (Build Test Scale) knowledge-base truth document with a human reviewer, in an ongoing conversation.
${sourceContext}

${placementContext}

${flagContext}

This is a CONVERSATION, not an edit machine. First decide the reviewer's intent:
- QUESTION / DISCUSSION (they ask about the draft, the sources, wording options, or say things like "what do you think", "why does it say X", "should we…"): DO NOT edit. Return ONLY {"reply":"<your answer or proposal>"} — answer from the draft and the source material, and when a change seems warranted, PROPOSE it concretely and ask whether to apply it.
- CORPUS-WIDE / MULTI-DOCUMENT REQUEST (a clear instruction to change wording or terminology, flag a concept, or leave notes ACROSS other documents or the whole corpus — e.g. "rename X in all drafts", "flag this mistake in every affected doc", "add a note to the other docs that say Y"): DO NOT edit and DO NOT attempt the cross-document work — you can only see THIS draft and you CANNOT write notes on other documents. Return ONLY {"reply":"..."} briefly explaining that refine works on this single draft, and that the CORPUS SWEEP tool (Pipeline Tools → Corpus Sweep on the review page) is the right tool: it finds every affected staging draft and live doc and proposes a note on each for the reviewer to confirm. If part of the instruction applies to THIS draft only, say they can ask for that part separately. Never return an edits/rewrite payload for a corpus-wide ask, and never claim you changed or annotated other documents.
- OUT-OF-PLACEMENT EDIT (a clear instruction to ADD substantive new subject matter that falls OUTSIDE this doc's filed shelf / node / doc-class charter — e.g. adding refund policy to a testing-methodology doc, or strategy to a navigation doc): DO NOT edit yet, and DO NOT re-file the doc yourself. Return ONLY {"placementCheck":{"query":"<3-8 keywords to search the corpus for where this content belongs>","summary":"<one sentence: what the reviewer wants to add>","concern":"<one sentence: why it may not belong in THIS doc>"}}. EXCEPTION: if the reviewer has ALREADY acknowledged the mismatch or overrides it (e.g. "add it here anyway", "I know, put it here", "ignore that, do it", or they asked again after you pushed back), then treat it as a normal EDIT and apply it.
- FLAG DISMISSAL (an EXPLICIT instruction to ignore/resolve/dismiss one of the CURRENT REVIEW FLAGS listed above — e.g. "ignore the high-stakes flag", "that passage is fine, dismiss it", "mark the single-source flag resolved"): DO NOT edit. Return ONLY {"dismissals":[{"target":"flag","type":"<exact type from the F-list>","reason":"<why, per the reviewer>"} or {"target":"highlight","kind":"<exact kind from the H-list>","excerpt":"<the exact excerpt from the H-list>","reason":"<why>"}],"message":"one sentence confirming what was dismissed"}. Only items from the lists above may be dismissed; never invent a type/kind/excerpt, and never dismiss anything the reviewer did not explicitly ask about.
- EDIT REQUEST (any other clear instruction to change the draft that stays WITHIN its placement, or the reviewer confirms a proposal you made, e.g. "yes do that", "apply it"): make the change as below.

FLAG HONESTY: you cannot make a review flag disappear by editing unless the edit actually removes the flag's trigger from the text (flags are recomputed deterministically after every edit). Never claim an edit "cleared" or "resolved" a flag. If the reviewer wants a flag gone without a text change, tell them to use the flag's Resolve/Ignore control — or to explicitly ask you to dismiss it (FLAG DISMISSAL above).

For EDITS, prefer SURGICAL edits. Return ONLY JSON of the form:
{"edits":[{"find":"exact text to replace","replace":"new text","all":false}],"message":"one sentence summary","changes":["human-readable description of each edit: what changed, where, and why"]}
- "find" must be an EXACT substring of the current draft (copy it verbatim). Use "all":true only to replace every occurrence; otherwise "find" must match exactly once.
- If the change is too broad for find/replace, instead return {"rewrite":"<full revised markdown body>","message":"...","changes":["..."]}.
- "changes" must let the reviewer verify each edit without diffing: name the section/heading affected and summarize before → after.
- Apply ONLY the requested change; preserve correct facts, headings and structure otherwise.
- You are given the ORIGINAL SOURCE MATERIAL this draft was consolidated from. When the reviewer asks to add, expand or correct content, PULL from that source material — do not invent facts and do not merely reshuffle the existing draft text.
BRAND RULES: say "Build Test Scale" / "BTS" (never "TCE" or "Cherrington"); no coach surnames; support email is support@buildtestscale.com.`;

    const userContent = `${priorTurns ? `CONVERSATION SO FAR:\n${priorTurns}\n\n` : ""}INSTRUCTION: ${instruction.trim()}\n\nTITLE: ${doc.title}\n\nCURRENT DRAFT:\n${current.substring(0, 12000)}${sourceMaterial ? `\n\n──────────\nORIGINAL SOURCE MATERIAL (for lookback; strongest first):\n${sourceMaterial}` : ""}`;

    // Shared retry helper: rate-limit-aware backoff + budget escalation on
    // reasoning-token starvation (the raw single-shot fetch was the old
    // silent-failure path). 12k initial budget: gpt-5 reasoning tokens eat
    // max_completion_tokens, and refine prompts (draft + source material +
    // conversation) routinely starved at 4k, sending the common case into
    // multi-minute escalation retries. Escalation stays as the backstop.
    const rawContent = (
      await callLLMWithRetry("refine", systemPrompt, userContent, 12000, true)
    ).trim();

    let parsed: { edits?: unknown; rewrite?: unknown; message?: unknown; reply?: unknown; changes?: unknown; placementCheck?: unknown; dismissals?: unknown };
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      throw new Error("AI returned malformed refine JSON");
    }

    const userId = (req as unknown as { userId: number }).userId;

    // Flag-dismissal turn (Task #1906): the reviewer explicitly asked the chat
    // to ignore/resolve a flag or flagged passage. Every target is validated
    // against the doc's CURRENT active flags/highlights — a hallucinated or
    // stale target is skipped and reported, never silently applied. The draft
    // text is untouched.
    if (
      Array.isArray(parsed.dismissals) &&
      !Array.isArray(parsed.edits) &&
      typeof parsed.rewrite !== "string"
    ) {
      const applied: string[] = [];
      const skipped: string[] = [];
      for (const raw of parsed.dismissals.slice(0, 10)) {
        if (!raw || typeof raw !== "object") continue;
        const d = raw as { target?: unknown; type?: unknown; kind?: unknown; excerpt?: unknown; reason?: unknown };
        const reasonStr =
          typeof d.reason === "string" && d.reason.trim()
            ? d.reason.trim().substring(0, 500)
            : `Dismissed via refine chat: ${instruction.trim().substring(0, 200)}`;

        if (d.target === "flag" && typeof d.type === "string") {
          const flag = lifecycle.activeFlags.find((f) => f.type === d.type);
          if (!flag) {
            skipped.push(`flag "${d.type}" (not an active flag on this draft)`);
            continue;
          }
          const fingerprint = flagFingerprint(flag);
          await db
            .insert(kbFlagResolutionsTable)
            .values({ stagingDocId: id, flagType: flag.type, fingerprint, resolvedBy: userId, reason: reasonStr })
            .onConflictDoUpdate({
              target: [kbFlagResolutionsTable.stagingDocId, kbFlagResolutionsTable.flagType],
              set: { fingerprint, resolvedBy: userId, reason: reasonStr, createdAt: new Date() },
            });
          await db.insert(kbTriageAuditLogTable).values({
            stagingDocId: id,
            eventType: "flag_resolved",
            confidenceScore: null,
            actorUserId: userId,
            aiReasoning: `Reviewer resolved the "${flag.type}" flag (${flag.severity}) via refine chat: ${flag.message} — reason: ${reasonStr}`,
            docTitle: doc.title,
          });
          applied.push(`flag "${flag.type}"`);
          continue;
        }

        if (d.target === "highlight" && typeof d.kind === "string" && typeof d.excerpt === "string") {
          if (d.kind === "possible_member_name") {
            skipped.push(`highlight "${d.excerpt}" (name highlights use the 'Not a name' control)`);
            continue;
          }
          const norm = normalizeExcerpt(d.excerpt);
          const h = lifecycle.activeHighlights.find(
            (x) => x.kind === d.kind && normalizeExcerpt(x.excerpt) === norm,
          );
          if (!h) {
            skipped.push(`highlight "${d.excerpt}" (not an active flagged passage on this draft)`);
            continue;
          }
          await db
            .insert(kbHighlightDismissalsTable)
            .values({
              kind: h.kind,
              excerptNorm: normalizeExcerpt(h.excerpt),
              displayExcerpt: h.excerpt,
              stagingDocId: id,
              dismissedBy: userId,
              reason: reasonStr,
            })
            .onConflictDoNothing({
              target: [kbHighlightDismissalsTable.kind, kbHighlightDismissalsTable.excerptNorm],
            });
          await db.insert(kbTriageAuditLogTable).values({
            stagingDocId: id,
            eventType: "highlight_dismissed",
            confidenceScore: null,
            actorUserId: userId,
            aiReasoning: `Reviewer ignored the ${h.label} highlight via refine chat: "${h.excerpt.substring(0, 200)}" — reason: ${reasonStr}`,
            docTitle: doc.title,
          });
          applied.push(`flagged passage "${h.excerpt.substring(0, 60)}"`);
          continue;
        }

        skipped.push("unrecognized dismissal target");
      }

      await recomputeNeedsExpert(id);
      const [freshDoc] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, id));

      const summary =
        (applied.length
          ? `Dismissed ${applied.join(", ")}.`
          : "Nothing was dismissed.") +
        (skipped.length ? ` Skipped: ${skipped.join("; ")}.` : "");
      const assistantMsg =
        typeof parsed.message === "string" && parsed.message.trim() && applied.length
          ? `${parsed.message.trim()} ${skipped.length ? `Skipped: ${skipped.join("; ")}.` : ""}`.trim()
          : summary;

      await db.insert(kbTriageAuditLogTable).values({
        stagingDocId: id,
        eventType: "refined",
        confidenceScore: null,
        actorUserId: userId,
        aiReasoning: `Dismissed flags (no edit) per instruction: ${instruction.trim().substring(0, 300)} — ${assistantMsg.substring(0, 1000)}`,
        docTitle: doc.title,
      });

      res.json({
        document: freshDoc ?? doc,
        mode: "dismissal",
        assistantMessage: assistantMsg,
        applied,
        skipped,
        changes: [],
        instruction: instruction.trim(),
      });
      return;
    }

    // Placement pushback (Task #1851): the reviewer asked to add subject matter
    // that falls outside this doc's filed shelf / node / doc-class charter. The
    // draft is NOT edited; instead we search the live corpus + other staging
    // drafts via retrieval to answer "already covered in X / belongs in Y /
    // genuine gap", and surface an advice bubble (with an optional target the
    // reviewer can leave a note on). Overrides bypass this branch upstream.
    const pc = parsed.placementCheck;
    if (
      pc &&
      typeof pc === "object" &&
      !Array.isArray(pc) &&
      !Array.isArray(parsed.edits) &&
      typeof parsed.rewrite !== "string"
    ) {
      const pcObj = pc as { query?: unknown; summary?: unknown; concern?: unknown };
      const query = typeof pcObj.query === "string" ? pcObj.query.trim() : "";
      const summary = typeof pcObj.summary === "string" ? pcObj.summary.trim() : "";
      const concern = typeof pcObj.concern === "string" ? pcObj.concern.trim() : "";

      // Search the live corpus (published truth docs) for existing coverage.
      type Candidate = { kind: "live" | "staging"; id: number; title: string; snippet: string };
      const candidates: Candidate[] = [];
      if (query) {
        try {
          const live = await retrieveSurfaceAware(query, {
            surface: "chat",
            categories: HOME_ROOTS.map((r) => r.slug),
            limit: 5,
          });
          for (const d of live.docs) {
            candidates.push({
              kind: "live",
              id: d.id,
              title: d.title,
              snippet: (d.content ?? "").replace(/\s+/g, " ").substring(0, 400),
            });
          }
        } catch {
          // Retrieval is best-effort; fall through with whatever we have.
        }

        // And other in-flight staging drafts (a sibling draft may already own it).
        try {
          const stagingRows = await db
            .select({
              id: kbStagingDocsTable.id,
              title: kbStagingDocsTable.title,
              content: kbStagingDocsTable.content,
              editedContent: kbStagingDocsTable.editedContent,
            })
            .from(kbStagingDocsTable)
            .where(
              and(
                ne(kbStagingDocsTable.id, id),
                ne(kbStagingDocsTable.status, "rejected"),
                sql`to_tsvector('english', ${kbStagingDocsTable.title} || ' ' || coalesce(${kbStagingDocsTable.editedContent}, ${kbStagingDocsTable.content}, '')) @@ plainto_tsquery('english', ${query})`,
              ),
            )
            .limit(4);
          for (const r of stagingRows) {
            candidates.push({
              kind: "staging",
              id: r.id,
              title: r.title,
              snippet: (r.editedContent ?? r.content ?? "").replace(/\s+/g, " ").substring(0, 400),
            });
          }
        } catch {
          // Ignore lexical search failures (e.g. empty tsquery).
        }
      }

      const allowedLive = new Set(candidates.filter((c) => c.kind === "live").map((c) => c.id));
      const allowedStaging = new Set(candidates.filter((c) => c.kind === "staging").map((c) => c.id));

      const corpusText = candidates.length
        ? candidates
            .map(
              (c, i) =>
                `[${i + 1}] ${c.kind === "live" ? "LIVE" : "STAGING"} #${c.id} — ${c.title}\n${c.snippet}`,
            )
            .join("\n\n")
        : "(no existing coverage found in the live corpus or other staging drafts)";

      const verdictSystem = `You advise a BTS knowledge-base reviewer on WHERE a piece of content belongs. You do NOT edit anything.
${placementContext}

The reviewer wants to add to THIS draft: ${summary || instruction.trim()}
Why it may not belong here: ${concern || "(the content falls outside this doc's placement)"}

EXISTING COVERAGE found by searching the corpus for "${query}":
${corpusText}

Decide ONE verdict:
- "already_covered": the content already exists in one of the LIVE/STAGING docs above — point there instead of duplicating.
- "belongs_elsewhere": it isn't written yet but clearly belongs in a different doc/shelf than this one (name the best target if one of the candidates fits).
- "genuine_gap": nothing covers it and it doesn't fit an existing doc — a new doc (or a re-file of this one) is warranted.
- "fits_here": on reflection it is actually within this doc's placement after all — the reviewer can proceed with the edit.

Return ONLY JSON: {"verdict":"already_covered|belongs_elsewhere|genuine_gap|fits_here","message":"<2-4 sentences of plain-language guidance to the reviewer>","target":{"kind":"live|staging","id":<number>,"title":"<title>"}|null}
- "target" may ONLY be one of the numbered candidates above (use its exact kind + id + title), or null. Never invent an id.`;

      const rawVerdict = (
        await callLLMWithRetry("refine-placement", verdictSystem, "Give your verdict now.", 3000, true)
      ).trim();

      let verdictParsed: { verdict?: unknown; message?: unknown; target?: unknown };
      try {
        verdictParsed = JSON.parse(rawVerdict);
      } catch {
        throw new Error("AI returned malformed placement verdict JSON");
      }

      const verdictRaw = typeof verdictParsed.verdict === "string" ? verdictParsed.verdict.trim() : "";
      const verdict = ["already_covered", "belongs_elsewhere", "genuine_gap", "fits_here"].includes(verdictRaw)
        ? verdictRaw
        : "genuine_gap";
      const guidance =
        typeof verdictParsed.message === "string" && verdictParsed.message.trim()
          ? verdictParsed.message.trim()
          : concern || "This addition may not belong in this document.";

      // Validate the AI's target against what retrieval actually returned — never
      // trust a hallucinated id. Staging targets that point at this same draft or
      // aren't note-able (no adminNotes support) are still fine to reference.
      let target: { kind: "live" | "staging"; id: number; title: string } | null = null;
      const t = verdictParsed.target;
      if (t && typeof t === "object" && !Array.isArray(t)) {
        const tk = (t as { kind?: unknown }).kind;
        const ti = (t as { id?: unknown }).id;
        const tt = (t as { title?: unknown }).title;
        const idNum = typeof ti === "number" ? ti : Number(ti);
        if (
          (tk === "live" && allowedLive.has(idNum)) ||
          (tk === "staging" && allowedStaging.has(idNum))
        ) {
          const match = candidates.find((c) => c.kind === tk && c.id === idNum);
          target = { kind: tk as "live" | "staging", id: idNum, title: (typeof tt === "string" && tt) || match?.title || "" };
        }
      }

      await db.insert(kbTriageAuditLogTable).values({
        stagingDocId: id,
        eventType: "refined",
        confidenceScore: null,
        actorUserId: userId,
        aiReasoning: `Placement pushback (${verdict}) on instruction: ${instruction.trim().substring(0, 200)} — ${guidance.substring(0, 1000)}${target ? ` [target: ${target.kind} #${target.id}]` : ""}`,
        docTitle: doc.title,
      });

      res.json({
        document: doc,
        mode: "placement",
        assistantMessage: guidance,
        verdict,
        target,
        changes: [],
        instruction: instruction.trim(),
      });
      return;
    }

    // Discussion turn: the model answered/proposed without editing. The draft
    // is untouched; the turn is still persisted so the thread survives reloads.
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    if (reply && !Array.isArray(parsed.edits) && typeof parsed.rewrite !== "string") {
      await db.insert(kbTriageAuditLogTable).values({
        stagingDocId: id,
        eventType: "refined",
        confidenceScore: null,
        actorUserId: userId,
        aiReasoning: `Discussed (no edit) per instruction: ${instruction.trim().substring(0, 300)} — ${reply.substring(0, 1200)}`,
        docTitle: doc.title,
      });
      res.json({ document: doc, mode: "discussion", assistantMessage: reply, changes: [], instruction: instruction.trim() });
      return;
    }

    // Patch-first: try the surgical edits. Fall back to a full rewrite only when
    // the edits can't be applied unambiguously (mis-copied anchor, zero/many
    // matches) or the model chose to rewrite.
    let revised: string | null = null;
    let mode: "patch" | "rewrite" = "patch";
    if (Array.isArray(parsed.edits)) {
      revised = applyRefineEdits(current, parsed.edits);
    }
    if (revised === null) {
      mode = "rewrite";
      if (typeof parsed.rewrite === "string" && parsed.rewrite.trim()) {
        revised = parsed.rewrite.trim();
      }
    }
    if (revised === null) {
      throw new Error("Refine could not be applied — no valid edits or rewrite returned");
    }

    const assistantMessage =
      typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message.trim()
        : "Draft updated.";
    // Per-edit human-readable change descriptions (model-provided). Fallback:
    // derive a terse find→replace listing so applied edits are never opaque.
    const changes: string[] = Array.isArray(parsed.changes)
      ? parsed.changes.map(String).filter((c) => c.trim()).slice(0, 12)
      : [];
    if (changes.length === 0 && mode === "patch" && Array.isArray(parsed.edits)) {
      for (const e of parsed.edits.slice(0, 12)) {
        const edit = e as { find?: unknown; replace?: unknown };
        if (typeof edit?.find === "string") {
          const from = edit.find.length > 80 ? edit.find.slice(0, 80) + "…" : edit.find;
          const to = typeof edit.replace === "string"
            ? (edit.replace.length > 80 ? edit.replace.slice(0, 80) + "…" : edit.replace)
            : "";
          changes.push(`Replaced "${from}" with "${to}"`);
        }
      }
    }

    const [updated] = await db
      .update(kbStagingDocsTable)
      .set({ editedContent: revised, status: "needs_review" })
      .where(eq(kbStagingDocsTable.id, id))
      .returning();

    await db.insert(kbTriageAuditLogTable).values({
      stagingDocId: id,
      eventType: "refined",
      confidenceScore: null,
      actorUserId: userId,
      aiReasoning:
        `Refined (${mode}) per instruction: ${instruction.trim().substring(0, 300)} — ${assistantMessage.substring(0, 200)}` +
        (changes.length ? `\nCHANGES:\n${changes.map((c) => `• ${c.substring(0, 300)}`).join("\n")}` : ""),
      docTitle: doc.title,
    });

    // Deterministic re-triage (Task #1906): recompute the stored risk flags
    // from the NEW text so an edit that removed a trigger clears its flag.
    await retriageDocFlags(id);
    const [retriaged] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, id));

    res.json({ document: retriaged ?? updated, mode, assistantMessage, changes, instruction: instruction.trim() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Persist the failure to the refine thread too: if the client already
    // aborted, this is the ONLY place the outcome survives — the review page
    // polls the thread and surfaces it, instead of a lost spinning turn.
    if (failCtx) {
      try {
        await db.insert(kbTriageAuditLogTable).values({
          stagingDocId: failCtx.docId,
          eventType: "refined",
          confidenceScore: null,
          actorUserId: failCtx.userId,
          aiReasoning: `Refine FAILED per instruction: ${failCtx.instruction.substring(0, 300)} — ⚠️ Refine failed: ${msg.substring(0, 600)}`,
          docTitle: failCtx.docTitle,
        });
      } catch (persistErr) {
        console.error(
          `[Refine] could not persist failure turn for doc ${failCtx.docId}: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`,
        );
      }
    }
    res.status(500).json({ error: msg });
  }
});

// Leave-a-note on the placement target (Task #1851). Opt-in follow-up to a
// placement-pushback verdict: the reviewer chooses to record a note on the doc
// the content really belongs to, so its future editor sees the overlap. Live
// docs carry it on ai_live_documents.reviewer_notes; staging drafts on
// kb_staging_docs.admin_notes. Append-only (existing note preserved + separated).
router.post("/:id/leave-note", async (req: Request, res: Response) => {
  try {
    const sourceId = parseInt(getParam(req.params.id));
    const { targetKind, targetId, note } = req.body as {
      targetKind?: unknown;
      targetId?: unknown;
      note?: unknown;
    };

    const kind = targetKind === "live" || targetKind === "staging" ? targetKind : null;
    const tId = typeof targetId === "number" ? targetId : Number(targetId);
    const text = typeof note === "string" ? note.trim() : "";
    if (!kind || !Number.isFinite(tId) || !text) {
      res.status(400).json({ error: "targetKind ('live'|'staging'), targetId, and note are required" });
      return;
    }

    const [source] = await db
      .select({ id: kbStagingDocsTable.id, title: kbStagingDocsTable.title })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, sourceId));
    if (!source) {
      res.status(404).json({ error: "Source draft not found" });
      return;
    }

    const userId = (req as unknown as { userId: number }).userId;
    const stamp = new Date().toISOString().slice(0, 10);
    const attribution = `[Reviewer note ${stamp} — flagged while reviewing “${source.title}” (#${sourceId})]`;
    const entry = `${attribution}\n${text}`;

    if (kind === "live") {
      const [target] = await db
        .select({ id: aiLiveDocumentsTable.id, title: aiLiveDocumentsTable.title, reviewerNotes: aiLiveDocumentsTable.reviewerNotes })
        .from(aiLiveDocumentsTable)
        .where(and(eq(aiLiveDocumentsTable.id, tId), sql`${aiLiveDocumentsTable.deletedAt} IS NULL`));
      if (!target) {
        res.status(404).json({ error: "Target live document not found" });
        return;
      }
      const merged = target.reviewerNotes ? `${target.reviewerNotes}\n\n${entry}` : entry;
      await db
        .update(aiLiveDocumentsTable)
        .set({ reviewerNotes: merged, updatedAt: new Date() })
        .where(eq(aiLiveDocumentsTable.id, tId));
      res.json({ ok: true, targetKind: kind, targetId: tId, targetTitle: target.title });
      return;
    }

    // staging target
    const [target] = await db
      .select({ id: kbStagingDocsTable.id, title: kbStagingDocsTable.title, adminNotes: kbStagingDocsTable.adminNotes })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, tId));
    if (!target) {
      res.status(404).json({ error: "Target staging draft not found" });
      return;
    }
    const merged = target.adminNotes ? `${target.adminNotes}\n\n${entry}` : entry;
    await db
      .update(kbStagingDocsTable)
      .set({ adminNotes: merged })
      .where(eq(kbStagingDocsTable.id, tId));
    res.json({ ok: true, targetKind: kind, targetId: tId, targetTitle: target.title });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Review insights (Task #1752 — sharpen the review-and-publish gate) ───────
//
// Everything the reviewer needs to adjudicate a draft BEFORE publish, computed
// fresh from the draft's CURRENT text (editedContent ?? content) so it stays
// accurate through edits/refines:
//   - highlights: risky passages (synthesis-threaded [SITUATIONAL]/[CONTEXT-
//     BOUND]/[ANOMALY] tags + SOURCE CONFLICT blockquotes, situational numbers,
//     time-sensitive phrasing, residual private-content matches) with the exact
//     line + excerpt so the UI can mark them in place;
//   - sources: the contributing source SET (call name, coach, date, authority),
//     source-set granularity only — no per-claim attribution.
router.get("/:id/review-insights", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const [doc] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    // Derived name-flag vocabulary (cached; TTL-refreshed) so terminology —
    // including NEW terminology from future synthesis runs — never flags.
    // Task #1906: dismissed highlights are split out (kind + normalized-excerpt
    // suppression, survives re-synthesis), and the stored risk flags come back
    // annotated with their resolution state so the UI can gate approval.
    const lifecycle = await getDocOutstanding(doc);
    const highlights = lifecycle.activeHighlights;

    // Provenance: the contributing source set. Enrich synthesisSources with the
    // transcript-source roster (coach, kind) and the source document's date.
    const synthSources = Array.isArray(doc.synthesisSources)
      ? (doc.synthesisSources as Array<{
          sourceDocId?: number | null;
          sourceType?: string | null;
          authorityRole?: string | null;
          sourceName?: string | null;
          transcriptSourceId?: number | null;
          relevance?: number | null;
        }>)
      : [];

    const transcriptIds = synthSources
      .map((s) => s.transcriptSourceId)
      .filter((v): v is number => typeof v === "number");
    const sourceDocIds = synthSources
      .map((s) => s.sourceDocId)
      .filter((v): v is number => typeof v === "number");

    const transcriptRows = transcriptIds.length
      ? await db
          .select({
            id: kbTranscriptSourcesTable.id,
            coachName: kbTranscriptSourcesTable.coachName,
            sourceKind: kbTranscriptSourcesTable.sourceKind,
            createdAt: kbTranscriptSourcesTable.createdAt,
          })
          .from(kbTranscriptSourcesTable)
          .where(inArray(kbTranscriptSourcesTable.id, transcriptIds))
      : [];
    const sourceDocRows = sourceDocIds.length
      ? await db
          .select({
            id: aiSourceDocumentsTable.id,
            sourceType: aiSourceDocumentsTable.sourceType,
            createdAt: aiSourceDocumentsTable.createdAt,
          })
          .from(aiSourceDocumentsTable)
          .where(inArray(aiSourceDocumentsTable.id, sourceDocIds))
      : [];
    const byTranscriptId = new Map(transcriptRows.map((r) => [r.id, r]));
    const bySourceDocId = new Map(sourceDocRows.map((r) => [r.id, r]));

    const sources = synthSources
      .slice()
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
      .map((s) => {
        const transcript = typeof s.transcriptSourceId === "number" ? byTranscriptId.get(s.transcriptSourceId) : undefined;
        const sourceDoc = typeof s.sourceDocId === "number" ? bySourceDocId.get(s.sourceDocId) : undefined;
        return {
          sourceName: s.sourceName ?? null,
          sourceType: s.sourceType ?? sourceDoc?.sourceType ?? null,
          sourceKind: transcript?.sourceKind ?? null,
          coachName: transcript?.coachName ?? null,
          authorityRole: s.authorityRole ?? null,
          relevance: s.relevance ?? null,
          // Best-available date: when the source entered the corpus.
          date: (transcript?.createdAt ?? sourceDoc?.createdAt)?.toISOString() ?? null,
        };
      });

    // Legacy single-source drafts: fall back to the one-source view.
    if (sources.length === 0 && (doc.sourceVideoTitle || doc.sourceId)) {
      sources.push({
        sourceName: doc.sourceVideoTitle ?? null,
        sourceType: null,
        sourceKind: null,
        coachName: null,
        authorityRole: doc.authorityRole ?? null,
        relevance: null,
        date: null,
      });
    }

    res.json({
      highlights,
      dismissedHighlights: lifecycle.dismissedHighlights,
      flagStates: lifecycle.flagStates,
      needsExpert: doc.needsExpert,
      sources,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/** Threaded refine history for a draft (audit-log-backed). */
router.get("/:id/refine-thread", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const rows = await db
      .select({
        id: kbTriageAuditLogTable.id,
        eventType: kbTriageAuditLogTable.eventType,
        reasoning: kbTriageAuditLogTable.aiReasoning,
        createdAt: kbTriageAuditLogTable.createdAt,
      })
      .from(kbTriageAuditLogTable)
      .where(
        and(
          eq(kbTriageAuditLogTable.stagingDocId, id),
          sql`${kbTriageAuditLogTable.eventType} IN ('refined','redrafted')`,
        ),
      )
      .orderBy(desc(kbTriageAuditLogTable.createdAt))
      .limit(50);
    res.json({ thread: rows });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Re-verify imported curated docs (Task #2, step 14) ───────────────────────
//
// The ~117 hand-written curated docs (doc_class='curated') from Task #1 carry no
// last_verified, so the citable filter holds them back. This pulls them into the
// review queue as `existing_doc` drafts so a human can confirm each on the
// fast/guided track. Idempotent: a curated doc already staged as existing_doc is
// skipped. Legacy refs are flagged so dated content is caught before re-verify.
router.post("/import-curated", async (_req: Request, res: Response) => {
  try {
    const curated = await db
      .select()
      .from(knowledgebaseDocsTable)
      .where(eq(knowledgebaseDocsTable.docClass, "curated"));

    // Titles already staged as existing_doc drafts — don't double-import.
    const existing = await db
      .select({ title: kbStagingDocsTable.title })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.docType, "existing_doc"));
    const staged = new Set(existing.map((r) => r.title));

    let imported = 0;
    let skipped = 0;

    for (const doc of curated) {
      if (staged.has(doc.title)) {
        skipped++;
        continue;
      }
      const staleRefs = detectLegacyRefs(doc.content);
      const tags = Array.isArray(doc.tags) ? doc.tags : [];

      await db.insert(kbStagingDocsTable).values({
        title: doc.title,
        category: doc.category,
        content: doc.content,
        tags: tags.join(", "),
        status: "needs_review",
        source: "curated_import",
        audience: doc.audience,
        docType: "existing_doc",
        originType: "curated_upload",
        docClassTarget: doc.docClass ?? "curated",
        homeRoot: doc.homeRoot,
        node: doc.node,
        taxonomyTags: tags,
        blitzSection: doc.blitzSection,
        ceiling: doc.ceiling,
        handoff: doc.handoff,
        staleReferences: staleRefs.length > 0 ? staleRefs : null,
        adminNotes: "Imported curated doc for re-verification (Task #1 corpus).",
      });
      imported++;
    }

    res.json({ imported, skipped, totalCurated: curated.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Blitz reference-doc import (Task #1914) ──────────────────────────────────
//
// Idempotent bulk import of the 96 AI Source Knowledge reference docs
// (`ai_source_documents.source_type = 'reference_docs'`) into the review
// queue, with automated cleanup (metadata header stripped, internal numbering
// removed, cross-references rewritten to member-facing Blitz guide sections,
// privacy/brand/confidential scrub, locked curated/process placement).
// Re-runs skip ANY-status existing row — rejected/deleted docs are never
// resurrected. New rows are handed straight to AI triage in the background.
router.post("/import-blitz-references", async (_req: Request, res: Response) => {
  try {
    const summary = await importBlitzReferenceDocs();

    let triageKicked = false;
    if (summary.importedIds.length > 0 && !isTriageRunning()) {
      const newDocs = await db
        .select()
        .from(kbStagingDocsTable)
        .where(inArray(kbStagingDocsTable.id, summary.importedIds));
      runTriageBackground(newDocs).catch((err) =>
        console.error("[Blitz Import] Triage error:", err),
      );
      triageKicked = true;
    }

    res.json({ ...summary, triageKicked, triageAlreadyRunning: isTriageRunning() && !triageKicked });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Corpus sweep (Task #1903) ─────────────────────────────────────────────────
//
// Cross-document correction proposals. Phrase mode: instant preview/confirm DB
// search. Concept mode: background LLM job with durable run state on
// kb_corpus_sweep_runs (survives restarts + connection timeouts). Both modes
// write NOTES only (staging → admin_notes, live → reviewer_notes, append-only)
// — never a document body. All routes inherit requirePermission("chat:manage").

router.post("/sweep/phrase/preview", async (req: Request, res: Response) => {
  try {
    const { phrases } = req.body as { phrases?: unknown };
    const clean = Array.isArray(phrases)
      ? phrases.filter((p): p is string => typeof p === "string" && p.trim().length > 1)
      : [];
    if (clean.length === 0) {
      res.status(400).json({ error: "At least one phrase (2+ characters) is required" });
      return;
    }
    const matches = await phraseSweepPreview(clean);
    res.json({ matches });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/sweep/phrase/confirm", async (req: Request, res: Response) => {
  try {
    const { phrases, replacement, targets } = req.body as {
      phrases?: unknown;
      replacement?: unknown;
      targets?: unknown;
    };
    const cleanPhrases = Array.isArray(phrases)
      ? phrases.filter((p): p is string => typeof p === "string" && p.trim().length > 1)
      : [];
    const cleanTargets = Array.isArray(targets)
      ? targets.filter(
          (t): t is { kind: "staging" | "live"; id: number } =>
            !!t &&
            typeof t === "object" &&
            ((t as { kind?: unknown }).kind === "staging" || (t as { kind?: unknown }).kind === "live") &&
            Number.isInteger((t as { id?: unknown }).id),
        )
      : [];
    if (cleanPhrases.length === 0 || typeof replacement !== "string" || !replacement.trim()) {
      res.status(400).json({ error: "phrases and replacement are required" });
      return;
    }
    if (cleanTargets.length === 0) {
      res.status(400).json({ error: "Select at least one document" });
      return;
    }
    const results = await phraseSweepConfirm(cleanPhrases, replacement.trim(), cleanTargets);
    res.json({ results, written: results.filter((r) => r.ok).length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/sweep/concept", async (req: Request, res: Response) => {
  try {
    const { incorrectConcept, correctConcept } = req.body as {
      incorrectConcept?: unknown;
      correctConcept?: unknown;
    };
    if (
      typeof incorrectConcept !== "string" ||
      incorrectConcept.trim().length < 10 ||
      typeof correctConcept !== "string" ||
      correctConcept.trim().length < 10
    ) {
      res.status(400).json({
        error: "Describe both the flawed concept and the correct framing (10+ characters each)",
      });
      return;
    }
    if (isConceptSweepRunning()) {
      res.status(409).json({ error: "A concept sweep is already running — wait for it to finish" });
      return;
    }
    const userId = (req as unknown as { userId?: number }).userId ?? null;
    const runId = await startConceptSweep(incorrectConcept.trim(), correctConcept.trim(), userId);
    res.json({ runId });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/sweep/concept/runs", async (_req: Request, res: Response) => {
  try {
    const runs = await listConceptSweepRuns(10);
    res.json({ runs });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/sweep/concept/runs/:runId", async (req: Request, res: Response) => {
  try {
    const runId = parseInt(getParam(req.params.runId));
    if (!Number.isInteger(runId)) {
      res.status(400).json({ error: "Invalid run id" });
      return;
    }
    const [run] = await db
      .select()
      .from(kbCorpusSweepRunsTable)
      .where(eq(kbCorpusSweepRunsTable.id, runId));
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({ run });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/sweep/concept/runs/:runId/confirm", async (req: Request, res: Response) => {
  try {
    const runId = parseInt(getParam(req.params.runId));
    const { targets } = req.body as { targets?: unknown };
    const cleanTargets = Array.isArray(targets)
      ? targets.filter(
          (t): t is { kind: "staging" | "live"; id: number } =>
            !!t &&
            typeof t === "object" &&
            ((t as { kind?: unknown }).kind === "staging" || (t as { kind?: unknown }).kind === "live") &&
            Number.isInteger((t as { id?: unknown }).id),
        )
      : [];
    if (cleanTargets.length === 0) {
      res.status(400).json({ error: "Select at least one document" });
      return;
    }
    const outcome = await confirmConceptSweep(runId, cleanTargets);
    if ("error" in outcome) {
      res.status(outcome.status ?? 500).json({ error: outcome.error });
      return;
    }
    res.json({ written: outcome.written, results: outcome.results });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
