import { getParam } from "../../lib/params";
import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { kbStagingDocsTable, knowledgebaseDocsTable, aiLiveDocumentsTable, aiLiveDocumentVersionsTable, kbDocProvenanceTable, kbTriageAuditLogTable, aiSourceDocumentsTable, kbTranscriptSourcesTable, kbNameFlagDismissalsTable } from "@workspace/db/schema";
import { eq, desc, sql, count, and, ne, isNotNull, inArray } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac.js";
import { resolveNavGapsForPublishedDoc } from "../../lib/kb-nav-gaps.js";
import { scrubPrivateContent } from "../../lib/content-privacy-filter";
import {
  undoAutoAction,
  runTriageBackground,
  runAutoTriageOnDoc,
  isTriageRunning,
} from "../../lib/kb-triage.js";
import { callLLMWithRetry } from "../../lib/kb-synthesis.js";
import { CITABLE_DOC_CLASSES } from "../../lib/kb-taxonomy.js";
import { detectLegacyRefs } from "../../lib/kb-mining.js";
import { blocksBulkConfirm, type RiskFlag } from "../../lib/kb-flags.js";
import { applyRefineEdits } from "../../lib/transcript-cleaner.js";
import { resolveSourceContentForSynthesis } from "../../lib/kb-value-screener.js";
import { analyzeDraftForReview, isPrivacyProtectedPair } from "../../lib/kb-review-risk.js";
import { getNameFlagVocab, invalidateNameFlagVocab } from "../../lib/kb-name-flag-vocab.js";
import { embedLiveDocumentInBackground, CLEARED_EMBEDDING_FIELDS } from "../../lib/kb-embeddings.js";

export { runTriageBackground } from "../../lib/kb-triage.js";

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
      where = sql`${where} AND to_tsvector('english', ${kbStagingDocsTable.title} || ' ' || ${kbStagingDocsTable.content}) @@ plainto_tsquery('english', ${search})`;
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
    ] = await Promise.all([
      db
        .select({ status: kbStagingDocsTable.status, cnt: count() })
        .from(kbStagingDocsTable)
        .groupBy(kbStagingDocsTable.status),
      db
        .select({ originType: kbStagingDocsTable.originType, cnt: count() })
        .from(kbStagingDocsTable)
        .groupBy(kbStagingDocsTable.originType),
      db
        .select({ docType: kbStagingDocsTable.docType, cnt: count() })
        .from(kbStagingDocsTable)
        .groupBy(kbStagingDocsTable.docType),
      db
        .select({ homeRoot: kbStagingDocsTable.homeRoot, cnt: count() })
        .from(kbStagingDocsTable)
        .groupBy(kbStagingDocsTable.homeRoot),
      db
        .select({ docClassTarget: kbStagingDocsTable.docClassTarget, cnt: count() })
        .from(kbStagingDocsTable)
        .groupBy(kbStagingDocsTable.docClassTarget),
      db.execute(sql`
        SELECT
          count(*) FILTER (WHERE ${BLOCKING_SQL})::int AS blocking,
          count(*) FILTER (WHERE ${FLAGGED_SQL})::int AS flagged,
          count(*) FILTER (WHERE ${kbStagingDocsTable.needsExpert} = true)::int AS needs_expert,
          count(*) FILTER (WHERE ${STALE_SQL})::int AS stale
        FROM ${kbStagingDocsTable}
      `),
      db.execute(sql`
        SELECT tag, count(*)::int AS cnt
        FROM ${kbStagingDocsTable}, jsonb_array_elements_text(${kbStagingDocsTable.taxonomyTags}) AS tag
        GROUP BY tag
        ORDER BY cnt DESC, tag ASC
      `),
      db
        .select({ node: kbStagingDocsTable.node, cnt: count() })
        .from(kbStagingDocsTable)
        .groupBy(kbStagingDocsTable.node),
      db.execute(sql`
        SELECT
          count(*) FILTER (WHERE ${kbStagingDocsTable.updateKind} = 'update')::int AS update_count,
          count(*) FILTER (WHERE ${kbStagingDocsTable.updateKind} IS NULL OR ${kbStagingDocsTable.updateKind} = 'new')::int AS new_count
        FROM ${kbStagingDocsTable}
      `),
    ]);

    const updateKindRow = (updateKindAgg.rows?.[0] ?? {}) as Record<string, unknown>;

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
      homeRoot,
      node,
      docClassTarget,
      ceiling,
      handoff,
      needsExpert,
      navApp,
      navArea,
    } = req.body;

    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (adminNotes !== undefined) updates.adminNotes = adminNotes;
    if (editedContent !== undefined) updates.editedContent = editedContent;
    if (title) updates.title = title;
    if (category) updates.category = category;
    if (tags !== undefined) updates.tags = tags;
    // Taxonomy fields the editor sends — previously dropped on the floor, so
    // reviewer edits to shelf / node / doc-class never persisted.
    if (homeRoot !== undefined) updates.homeRoot = homeRoot || null;
    if (node !== undefined) updates.node = node || null;
    if (docClassTarget !== undefined) updates.docClassTarget = docClassTarget || null;
    if (ceiling !== undefined) updates.ceiling = ceiling || null;
    if (handoff !== undefined) updates.handoff = handoff || null;
    if (needsExpert !== undefined) updates.needsExpert = needsExpert;
    if (navApp !== undefined) updates.navApp = navApp || null;
    if (navArea !== undefined) updates.navArea = navArea || null;

    if (status === "approved" || status === "rejected" || status === "needs_review") {
      updates.reviewedBy = (req as unknown as { userId: number }).userId;
      updates.reviewedAt = new Date();
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
      const [doc] = await db
        .select({ riskFlags: kbStagingDocsTable.riskFlags, needsExpert: kbStagingDocsTable.needsExpert })
        .from(kbStagingDocsTable)
        .where(eq(kbStagingDocsTable.id, id));
      if (!doc) continue;
      if (doc.needsExpert || blocksBulkConfirm((doc.riskFlags ?? []) as RiskFlag[])) {
        blocked.push(id);
        continue;
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
                category: doc.category,
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
              category: doc.category,
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

    const systemPrompt = `You are refining a BTS (Build Test Scale) knowledge-base truth document with a human reviewer, in an ongoing conversation.
${sourceContext}

This is a CONVERSATION, not an edit machine. First decide the reviewer's intent:
- QUESTION / DISCUSSION (they ask about the draft, the sources, wording options, or say things like "what do you think", "why does it say X", "should we…"): DO NOT edit. Return ONLY {"reply":"<your answer or proposal>"} — answer from the draft and the source material, and when a change seems warranted, PROPOSE it concretely and ask whether to apply it.
- EDIT REQUEST (a clear instruction to change the draft, or the reviewer confirms a proposal you made, e.g. "yes do that", "apply it"): make the change as below.

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
    // silent-failure path).
    const rawContent = (
      await callLLMWithRetry("refine", systemPrompt, userContent, 4000, true)
    ).trim();

    let parsed: { edits?: unknown; rewrite?: unknown; message?: unknown; reply?: unknown; changes?: unknown };
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      throw new Error("AI returned malformed refine JSON");
    }

    const userId = (req as unknown as { userId: number }).userId;

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

    res.json({ document: updated, mode, assistantMessage, changes, instruction: instruction.trim() });
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
    const highlights = analyzeDraftForReview(
      doc.editedContent ?? doc.content,
      await getNameFlagVocab(),
    );

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

    res.json({ highlights, sources });
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

export default router;
