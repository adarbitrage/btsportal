import { Router, type IRouter } from "express";
import { db, aiSourceDocumentsTable, kbCallScreeningsTable, kbScreenedExchangesTable } from "@workspace/db";
import { eq, inArray, desc } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac";
import { getParam } from "../../lib/params";
import {
  screenSourcesBackground,
  getScreenerState,
  isScreenerRunning,
  effectiveDisposition,
  computeAnomalyFlags,
  deriveFoldSignals,
  SEGMENT_MAX_CHARS,
  SCREENER_SOURCE_FOLDERS,
} from "../../lib/kb-value-screener.js";

/**
 * Admin API for the coaching-transcript VALUE SCREENER (Task #1702, refined
 * #1707). Mounted at root; every path is namespaced under
 * /admin/kb-value-screener and gated by chat:manage. Reads cleared coaching
 * sources from ai_source_documents and reads/writes ONLY the screener's own
 * tables — it never touches the screening/mining gates or the synthesis engine,
 * and nothing is auto-published.
 */
const router: IRouter = Router();

// Admin overrules choose a real verdict only — never the "error" reliability
// status, which is reserved for a genuine classification failure.
const OVERRIDE_DISPOSITIONS = ["keep", "drop", "flag"] as const;
const isOverrideDisposition = (v: unknown): v is (typeof OVERRIDE_DISPOSITIONS)[number] =>
  typeof v === "string" && (OVERRIDE_DISPOSITIONS as readonly string[]).includes(v);

/** Derive the errored-segment count from the persisted roll-ups. */
const errorCountOf = (sc: {
  exchangeCount: number;
  keptCount: number;
  droppedCount: number;
  flaggedCount: number;
}) => Math.max(0, sc.exchangeCount - sc.keptCount - sc.droppedCount - sc.flaggedCount);

/**
 * GET /admin/kb-value-screener/sources — the run-and-audit console's source
 * list: every cleared coaching source plus its screening summary (if any).
 */
router.get("/admin/kb-value-screener/sources", requirePermission("chat:manage"), async (_req, res): Promise<void> => {
  const sources = await db
    .select({
      id: aiSourceDocumentsTable.id,
      title: aiSourceDocumentsTable.title,
      sourceType: aiSourceDocumentsTable.sourceType,
      sourceName: aiSourceDocumentsTable.sourceName,
      updatedAt: aiSourceDocumentsTable.updatedAt,
    })
    .from(aiSourceDocumentsTable)
    .where(inArray(aiSourceDocumentsTable.sourceType, SCREENER_SOURCE_FOLDERS))
    .orderBy(desc(aiSourceDocumentsTable.updatedAt));

  const screenings = await db.select().from(kbCallScreeningsTable);
  const byId = new Map(screenings.map((s) => [s.sourceDocId, s]));

  res.json({
    sources: sources.map((s) => {
      const sc = byId.get(s.id);
      return {
        ...s,
        screening: sc
          ? {
              dedupStatus: sc.dedupStatus,
              duplicateOfSourceId: sc.duplicateOfSourceId,
              similarityScore: sc.similarityScore,
              exchangeCount: sc.exchangeCount,
              keptCount: sc.keptCount,
              droppedCount: sc.droppedCount,
              flaggedCount: sc.flaggedCount,
              errorCount: errorCountOf(sc),
              maxSegmentChars: sc.maxSegmentChars,
              sourceCharCount: sc.sourceCharCount,
              // Anomalous shapes (oversized segment / implausibly few segments
              // / all-error) are surfaced for admin attention, never silent.
              anomalies: computeAnomalyFlags(sc),
              screenedAt: sc.updatedAt,
            }
          : null,
      };
    }),
  });
});

/** GET /admin/kb-value-screener/status — background run state. */
router.get("/admin/kb-value-screener/status", requirePermission("chat:manage"), async (_req, res): Promise<void> => {
  res.json(getScreenerState());
});

/**
 * POST /admin/kb-value-screener/run — screen a chosen SUBSET.
 * Body: { sourceDocIds: number[], force?: boolean }. Fire-and-forget.
 */
router.post("/admin/kb-value-screener/run", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  if (isScreenerRunning()) {
    res.status(409).json({ error: "A screening run is already in progress" });
    return;
  }
  const { sourceDocIds, force } = req.body as { sourceDocIds?: unknown; force?: boolean };
  const ids = Array.isArray(sourceDocIds)
    ? sourceDocIds.map((n) => Number(n)).filter((n) => Number.isInteger(n))
    : [];
  if (ids.length === 0) {
    res.status(400).json({ error: "sourceDocIds must be a non-empty array of source ids" });
    return;
  }

  // Validate the ids are cleared coaching sources.
  const valid = await db
    .select({ id: aiSourceDocumentsTable.id })
    .from(aiSourceDocumentsTable)
    .where(inArray(aiSourceDocumentsTable.id, ids));
  const validIds = valid.map((v) => v.id);
  if (validIds.length === 0) {
    res.status(400).json({ error: "No valid source documents in selection" });
    return;
  }

  // Fire-and-forget; the client polls /status.
  void screenSourcesBackground(validIds, { force: force === true });
  res.status(202).json({ started: true, total: validIds.length });
});

/**
 * GET /admin/kb-value-screener/results/:sourceDocId — the full screened output
 * for one source (kept + dropped + flagged + errored segments) for the audit view.
 */
router.get("/admin/kb-value-screener/results/:sourceDocId", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const sourceDocId = parseInt(getParam(req.params.sourceDocId));
  if (isNaN(sourceDocId)) {
    res.status(400).json({ error: "Invalid source id" });
    return;
  }

  const [source] = await db
    .select({ id: aiSourceDocumentsTable.id, title: aiSourceDocumentsTable.title })
    .from(aiSourceDocumentsTable)
    .where(eq(aiSourceDocumentsTable.id, sourceDocId));
  if (!source) {
    res.status(404).json({ error: "Source not found" });
    return;
  }

  const [screening] = await db
    .select()
    .from(kbCallScreeningsTable)
    .where(eq(kbCallScreeningsTable.sourceDocId, sourceDocId));
  if (!screening) {
    res.json({ source, screening: null, exchanges: [] });
    return;
  }

  const exchanges = await db
    .select()
    .from(kbScreenedExchangesTable)
    .where(eq(kbScreenedExchangesTable.screeningId, screening.id))
    .orderBy(kbScreenedExchangesTable.orderIndex);

  const anomalies = computeAnomalyFlags(screening);
  // When the oversized flag fires, identify WHICH segment(s) tripped it and by
  // how much, so the admin knows what to look at.
  const oversizedSegments = anomalies.includes("oversized_segment")
    ? exchanges
        .filter((e) => e.passage.length > SEGMENT_MAX_CHARS)
        .map((e) => ({
          id: e.id,
          orderIndex: e.orderIndex,
          chars: e.passage.length,
          overBy: e.passage.length - SEGMENT_MAX_CHARS,
        }))
    : [];

  res.json({
    source,
    screening: {
      ...screening,
      errorCount: errorCountOf(screening),
      anomalies,
      maxSegmentCap: SEGMENT_MAX_CHARS,
      oversizedSegments,
    },
    exchanges: exchanges.map((e) => ({
      ...e,
      effectiveDisposition: effectiveDisposition(e),
      // Structured fold signal (derived from the recorded fold marker) so the
      // reviewer UI never string-matches passage text.
      ...deriveFoldSignals(e),
    })),
  });
});

/**
 * POST /admin/kb-value-screener/exchanges/:id/override — an admin overrule on a
 * single segment. Body: { disposition: keep|drop|flag }.
 */
router.post("/admin/kb-value-screener/exchanges/:id/override", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(getParam(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid exchange id" });
    return;
  }
  const { disposition } = req.body as { disposition?: unknown };
  if (!isOverrideDisposition(disposition)) {
    res.status(400).json({ error: "disposition must be one of keep|drop|flag" });
    return;
  }

  const [ex] = await db.select().from(kbScreenedExchangesTable).where(eq(kbScreenedExchangesTable.id, id));
  if (!ex) {
    res.status(404).json({ error: "Exchange not found" });
    return;
  }

  await db
    .update(kbScreenedExchangesTable)
    .set({ overrideDisposition: disposition, overrideBy: req.userId ?? null, overrideAt: new Date() })
    .where(eq(kbScreenedExchangesTable.id, id));

  res.json({ ok: true });
});

export default router;
