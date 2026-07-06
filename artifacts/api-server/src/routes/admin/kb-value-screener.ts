import { Router, type IRouter } from "express";
import { db, aiSourceDocumentsTable, kbCallScreeningsTable, kbScreenedExchangesTable, kbCalibrationExamplesTable } from "@workspace/db";
import { eq, inArray, desc } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac";
import { getParam } from "../../lib/params";
import {
  screenSourcesBackground,
  getScreenerState,
  isScreenerRunning,
  getCalibrationVersion,
  loadActiveCalibration,
  effectiveDisposition,
  SCREENER_SOURCE_FOLDERS,
  DISPOSITIONS,
  VALUE_TYPES,
  type Disposition,
} from "../../lib/kb-value-screener.js";

/**
 * Admin API for the coaching-transcript VALUE SCREENER (Task #1702). Mounted at
 * root; every path is namespaced under /admin/kb-value-screener and gated by
 * chat:manage. Reads cleared coaching sources from ai_source_documents and
 * reads/writes ONLY the screener's own tables — it never touches the
 * screening/mining gates or the synthesis engine, and nothing is auto-published.
 */
const router: IRouter = Router();

const isDisposition = (v: unknown): v is Disposition =>
  typeof v === "string" && (DISPOSITIONS as readonly string[]).includes(v);

/**
 * GET /admin/kb-value-screener/sources — the pilot's selectable source list:
 * every cleared coaching source plus its screening summary (if any).
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

  const currentVersion = await getCalibrationVersion();

  res.json({
    calibrationVersion: currentVersion,
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
              calibrationVersion: sc.calibrationVersion,
              stale: sc.calibrationVersion !== currentVersion,
              screenedAt: sc.updatedAt,
            }
          : null,
      };
    }),
  });
});

/** GET /admin/kb-value-screener/status — background pilot run state. */
router.get("/admin/kb-value-screener/status", requirePermission("chat:manage"), async (_req, res): Promise<void> => {
  res.json({ ...getScreenerState(), calibrationVersion: await getCalibrationVersion() });
});

/**
 * POST /admin/kb-value-screener/run — screen a chosen SUBSET (the pilot).
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
 * for one source (kept AND dropped exchanges) for the preview screen.
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

  res.json({
    source,
    screening,
    exchanges: exchanges.map((e) => ({ ...e, effectiveDisposition: effectiveDisposition(e) })),
  });
});

/**
 * POST /admin/kb-value-screener/exchanges/:id/override — an admin overrule on a
 * single unit. Optionally feeds the corrected verdict into the calibration set.
 * Body: { disposition: keep|drop|flag, feedToCalibration?: boolean }.
 */
router.post("/admin/kb-value-screener/exchanges/:id/override", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(getParam(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid exchange id" });
    return;
  }
  const { disposition, feedToCalibration } = req.body as { disposition?: unknown; feedToCalibration?: boolean };
  if (!isDisposition(disposition)) {
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

  // Feed the overrule into calibration: a keep→gold, a drop→noise exemplar.
  if (feedToCalibration === true && disposition !== "flag") {
    await db.insert(kbCalibrationExamplesTable).values({
      memberPrompt: ex.memberPrompt,
      coachResponse: ex.coachResponse,
      label: disposition === "keep" ? "gold" : "noise",
      valueType: disposition === "keep" ? ex.valueType : null,
      note: "Captured from a pilot-screen overrule",
      sourceExchangeId: ex.id,
      createdBy: req.userId ?? null,
    });
  }

  res.json({ ok: true });
});

/** GET /admin/kb-value-screener/calibration — the coach calibration set. */
router.get("/admin/kb-value-screener/calibration", requirePermission("chat:manage"), async (_req, res): Promise<void> => {
  const examples = await loadActiveCalibration();
  // Include inactive ones too so the admin screen can re-enable them.
  const all = await db
    .select()
    .from(kbCalibrationExamplesTable)
    .orderBy(desc(kbCalibrationExamplesTable.createdAt));
  res.json({
    version: await getCalibrationVersion(),
    activeCount: examples.length,
    goldCount: examples.filter((e) => e.label === "gold").length,
    noiseCount: examples.filter((e) => e.label === "noise").length,
    examples: all,
    valueTypes: VALUE_TYPES,
  });
});

/** GET /admin/kb-value-screener/calibration/candidates — flagged/borderline
 *  screened exchanges the admin can label to grow the calibration set. */
router.get("/admin/kb-value-screener/calibration/candidates", requirePermission("chat:manage"), async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: kbScreenedExchangesTable.id,
      sourceDocId: kbScreenedExchangesTable.sourceDocId,
      memberPrompt: kbScreenedExchangesTable.memberPrompt,
      coachResponse: kbScreenedExchangesTable.coachResponse,
      valueType: kbScreenedExchangesTable.valueType,
      disposition: kbScreenedExchangesTable.disposition,
      rationale: kbScreenedExchangesTable.rationale,
    })
    .from(kbScreenedExchangesTable)
    .where(eq(kbScreenedExchangesTable.disposition, "flag"))
    .orderBy(desc(kbScreenedExchangesTable.id))
    .limit(50);
  res.json({ candidates: rows });
});

/**
 * POST /admin/kb-value-screener/calibration — add an exemplar.
 * Body: { memberPrompt?, coachResponse, label: gold|noise, valueType?, note? }.
 */
router.post("/admin/kb-value-screener/calibration", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const { memberPrompt, coachResponse, label, valueType, note } = req.body as {
    memberPrompt?: string;
    coachResponse?: string;
    label?: string;
    valueType?: string;
    note?: string;
  };
  if (label !== "gold" && label !== "noise") {
    res.status(400).json({ error: "label must be 'gold' or 'noise'" });
    return;
  }
  if (!coachResponse || !coachResponse.trim()) {
    res.status(400).json({ error: "coachResponse is required" });
    return;
  }
  const [row] = await db
    .insert(kbCalibrationExamplesTable)
    .values({
      memberPrompt: (memberPrompt ?? "").trim(),
      coachResponse: coachResponse.trim(),
      label,
      valueType: label === "gold" && valueType && (VALUE_TYPES as readonly string[]).includes(valueType) ? valueType : null,
      note: note?.trim() || null,
      createdBy: req.userId ?? null,
    })
    .returning();
  res.status(201).json(row);
});

/** PATCH /admin/kb-value-screener/calibration/:id — toggle active / edit. */
router.patch("/admin/kb-value-screener/calibration/:id", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(getParam(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { active, note } = req.body as { active?: boolean; note?: string };
  const patch: Record<string, unknown> = {};
  if (typeof active === "boolean") patch.active = active;
  if (typeof note === "string") patch.note = note.trim() || null;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }
  const [row] = await db
    .update(kbCalibrationExamplesTable)
    .set(patch)
    .where(eq(kbCalibrationExamplesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

/** DELETE /admin/kb-value-screener/calibration/:id — remove an exemplar. */
router.delete("/admin/kb-value-screener/calibration/:id", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(getParam(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(kbCalibrationExamplesTable).where(eq(kbCalibrationExamplesTable.id, id));
  res.json({ ok: true });
});

export default router;
