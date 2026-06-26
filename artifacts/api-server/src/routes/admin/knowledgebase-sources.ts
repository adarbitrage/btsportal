/**
 * KB transcript-source registry routes (Task #2, step 15).
 *
 * Screens every transcript SOURCE before any mining runs: internal/private
 * recordings are auto-quarantined by name so the miner never drafts from them.
 * Admins can override every decision (confirm-training / quarantine / restore /
 * set authority role). The `rescan` sweep is idempotent and NEVER clobbers a
 * human override (ON CONFLICT (source_name) DO NOTHING).
 */

import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { kbTranscriptSourcesTable } from "@workspace/db/schema";
import { eq, sql, asc } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac.js";
import { getParam } from "../../lib/params";
import { populateSources } from "../../lib/kb-source-registry.js";
import { AUTHORITY_ROLES, SOURCE_DISPOSITIONS } from "../../lib/kb-taxonomy.js";

const router = Router();
router.use(requirePermission("chat:manage"));

/**
 * POST /rescan — idempotent population sweep. Inserts any newly-discovered
 * source with its screened disposition + resolved authority role; existing
 * rows (incl. human overrides) are left untouched.
 */
router.post("/rescan", async (_req: Request, res: Response) => {
  try {
    const { discovered, inserted, quarantined } = await populateSources();
    res.json({
      message: `Rescan complete: ${inserted} new source(s) registered (${quarantined} quarantined).`,
      discovered,
      inserted,
      quarantined,
    });
  } catch (err) {
    console.error("[kb-sources] rescan failed:", err);
    res.status(500).json({ error: "Failed to rescan transcript sources" });
  }
});

/** GET / — list sources with counts. Optional ?disposition= / ?role= / ?kind= / ?search=. */
router.get("/", async (req: Request, res: Response) => {
  try {
    const disposition = (req.query.disposition as string) || undefined;
    const role = (req.query.role as string) || undefined;
    const kind = (req.query.kind as string) || undefined;
    const search = (req.query.search as string) || undefined;

    let where = sql`1=1`;
    if (disposition) where = sql`${where} AND ${kbTranscriptSourcesTable.disposition} = ${disposition}`;
    if (role) where = sql`${where} AND ${kbTranscriptSourcesTable.authorityRole} = ${role}`;
    if (kind) where = sql`${where} AND ${kbTranscriptSourcesTable.sourceKind} = ${kind}`;
    if (search) where = sql`${where} AND ${kbTranscriptSourcesTable.sourceName} ILIKE ${"%" + search + "%"}`;

    const rows = await db
      .select()
      .from(kbTranscriptSourcesTable)
      .where(where)
      .orderBy(asc(kbTranscriptSourcesTable.disposition), asc(kbTranscriptSourcesTable.sourceName));

    const counts = await db
      .select({ disposition: kbTranscriptSourcesTable.disposition, cnt: sql<number>`count(*)::int` })
      .from(kbTranscriptSourcesTable)
      .groupBy(kbTranscriptSourcesTable.disposition);

    res.json({
      sources: rows,
      counts: counts.reduce((acc, c) => ({ ...acc, [c.disposition]: c.cnt }), {} as Record<string, number>),
    });
  } catch (err) {
    console.error("[kb-sources] list failed:", err);
    res.status(500).json({ error: "Failed to list transcript sources" });
  }
});

async function setDisposition(
  req: Request,
  res: Response,
  disposition: (typeof SOURCE_DISPOSITIONS)[number],
  authorityOverride?: string,
) {
  const id = parseInt(getParam(req.params.id) || "", 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid source id" });
    return;
  }
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : undefined;
  const update: Record<string, unknown> = { disposition };
  if (authorityOverride) update.authorityRole = authorityOverride;
  if (note) update.notes = note;

  const updated = await db
    .update(kbTranscriptSourcesTable)
    .set(update)
    .where(eq(kbTranscriptSourcesTable.id, id))
    .returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "Source not found" });
    return;
  }
  res.json({ source: updated[0] });
}

/** POST /:id/confirm-training — mark a source member-facing (clears quarantine). */
router.post("/:id/confirm-training", (req, res) => void setDisposition(req, res, "training"));

/** POST /:id/quarantine — exclude a source from members + mining. */
router.post("/:id/quarantine", async (req: Request, res: Response) => {
  const id = parseInt(getParam(req.params.id) || "", 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid source id" });
    return;
  }
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : undefined;
  const updated = await db
    .update(kbTranscriptSourcesTable)
    .set({ disposition: "quarantined", authorityRole: "internal", ...(note ? { notes: note } : {}) })
    .where(eq(kbTranscriptSourcesTable.id, id))
    .returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "Source not found" });
    return;
  }
  res.json({ source: updated[0] });
});

/** POST /:id/restore — alias of confirm-training (back to member-facing). */
router.post("/:id/restore", (req, res) => void setDisposition(req, res, "training"));

/** POST /:id/authority — override the authority role. */
router.post("/:id/authority", async (req: Request, res: Response) => {
  const role = typeof req.body?.authorityRole === "string" ? req.body.authorityRole : "";
  if (!AUTHORITY_ROLES.includes(role as (typeof AUTHORITY_ROLES)[number])) {
    res.status(400).json({ error: `authorityRole must be one of: ${AUTHORITY_ROLES.join(", ")}` });
    return;
  }
  const id = parseInt(getParam(req.params.id) || "", 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid source id" });
    return;
  }
  const updated = await db
    .update(kbTranscriptSourcesTable)
    .set({ authorityRole: role })
    .where(eq(kbTranscriptSourcesTable.id, id))
    .returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "Source not found" });
    return;
  }
  res.json({ source: updated[0] });
});

export default router;
