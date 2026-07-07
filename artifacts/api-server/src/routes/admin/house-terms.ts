import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { btsHouseTermAliasesTable, transcriptCleanerDocumentsTable } from "@workspace/db/schema";
import { eq, asc, desc, isNotNull } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac.js";
import { logAdminAction } from "../../lib/audit-log.js";
import { refreshHouseTermAliasCache } from "../../lib/bts-house-terms.js";
import {
  BTS_TERM_ALIASES,
  listHouseTermCorrections,
  findUnrecognizedHouseTokens,
  type HouseTermCorrection,
} from "../../lib/transcript-cleaner.js";

const router = Router();
router.use(requirePermission("chat:manage"));

/** Normalise a misspelling key: trimmed + lowercased (matched case-insensitively). */
function cleanKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// ── List: DB overrides + the read-only code baseline ─────────────────────────
router.get("/", async (_req: Request, res: Response) => {
  try {
    const aliases = await db
      .select()
      .from(btsHouseTermAliasesTable)
      .orderBy(asc(btsHouseTermAliasesTable.misspelling));
    res.json({
      aliases,
      // Code baseline (read-only context — merged at runtime, never editable here).
      baseline: Object.entries(BTS_TERM_ALIASES).map(([misspelling, canonical]) => ({ misspelling, canonical })),
    });
  } catch (err) {
    console.error("[house-terms] list failed:", err);
    res.status(500).json({ error: "Failed to load house-term aliases" });
  }
});

// ── Review: corrections applied + slipped-through candidates on recent docs ───
router.get("/review", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
    const docs = await db
      .select({
        id: transcriptCleanerDocumentsTable.id,
        title: transcriptCleanerDocumentsTable.title,
        sourceName: transcriptCleanerDocumentsTable.sourceName,
        original: transcriptCleanerDocumentsTable.originalContent,
        cleaned: transcriptCleanerDocumentsTable.cleanedContent,
      })
      .from(transcriptCleanerDocumentsTable)
      .where(isNotNull(transcriptCleanerDocumentsTable.cleanedContent))
      .orderBy(desc(transcriptCleanerDocumentsTable.updatedAt))
      .limit(limit);

    // Aggregate the corrections the cleaner applies (from the raw input) …
    const correctionsByKey = new Map<string, HouseTermCorrection>();
    // … and the near-house tokens it left alone in the CLEANED output (still
    //   uncorrected = genuine review candidates a human should promote).
    const candidateMap = new Map<
      string,
      { token: string; suggestedCanonical: string; distance: number; count: number; exampleTitle: string; exampleDocId: number }
    >();

    for (const doc of docs) {
      for (const c of listHouseTermCorrections(doc.original ?? "")) {
        const k = `${c.via}:${c.from}->${c.to}`;
        const existing = correctionsByKey.get(k);
        if (existing) existing.count += c.count;
        else correctionsByKey.set(k, { ...c });
      }
      const label = (doc.title || doc.sourceName || `#${doc.id}`).slice(0, 120);
      for (const cand of findUnrecognizedHouseTokens(doc.cleaned ?? "")) {
        const key = cand.token.toLowerCase();
        const existing = candidateMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          candidateMap.set(key, {
            token: cand.token,
            suggestedCanonical: cand.suggestedCanonical,
            distance: cand.distance,
            count: 1,
            exampleTitle: label,
            exampleDocId: doc.id,
          });
        }
      }
    }

    res.json({
      scannedDocs: docs.length,
      corrections: [...correctionsByKey.values()].sort((a, b) => b.count - a.count),
      candidates: [...candidateMap.values()].sort((a, b) => b.count - a.count || a.distance - b.distance),
    });
  } catch (err) {
    console.error("[house-terms] review failed:", err);
    res.status(500).json({ error: "Failed to build review" });
  }
});

// ── Create an alias override ─────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  try {
    const misspelling = cleanKey(req.body.misspelling);
    const canonical = typeof req.body.canonical === "string" ? req.body.canonical.trim() : "";
    const note = typeof req.body.note === "string" && req.body.note.trim() ? req.body.note.trim() : null;
    const source = req.body.source === "review_approved" ? "review_approved" : "admin";

    if (misspelling.length < 3) {
      return res.status(400).json({ error: "Misspelling must be at least 3 characters" });
    }
    if (!canonical) return res.status(400).json({ error: "Canonical replacement is required" });
    if (misspelling === canonical.toLowerCase()) {
      return res.status(400).json({ error: "Misspelling and canonical are identical — nothing to correct" });
    }

    const existing = await db
      .select({ id: btsHouseTermAliasesTable.id })
      .from(btsHouseTermAliasesTable)
      .where(eq(btsHouseTermAliasesTable.misspelling, misspelling))
      .limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: `An alias for "${misspelling}" already exists` });
    }

    const [row] = await db
      .insert(btsHouseTermAliasesTable)
      .values({
        misspelling,
        canonical,
        note,
        source,
        enabled: req.body.enabled === false ? false : true,
        createdBy: req.userId ?? null,
      })
      .returning();

    await refreshHouseTermAliasCache();
    logAdminAction(req, "create", "bts_house_term_alias", String(row.id), `Added house-term alias "${misspelling}" → "${canonical}"`);
    return res.status(201).json({ alias: row });
  } catch (err) {
    console.error("[house-terms] create failed:", err);
    return res.status(500).json({ error: "Failed to create house-term alias" });
  }
});

// ── Edit an alias override (canonical / enabled / note) ───────────────────────
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const [current] = await db.select().from(btsHouseTermAliasesTable).where(eq(btsHouseTermAliasesTable.id, id)).limit(1);
    if (!current) return res.status(404).json({ error: "Alias not found" });

    const update: Partial<typeof btsHouseTermAliasesTable.$inferInsert> = {};
    if (typeof req.body.canonical === "string" && req.body.canonical.trim()) {
      update.canonical = req.body.canonical.trim();
    }
    if (req.body.note !== undefined) {
      update.note = typeof req.body.note === "string" && req.body.note.trim() ? req.body.note.trim() : null;
    }
    if (req.body.enabled !== undefined) update.enabled = req.body.enabled !== false;
    if (Object.keys(update).length === 0) return res.status(400).json({ error: "Nothing to update" });

    const [row] = await db
      .update(btsHouseTermAliasesTable)
      .set(update)
      .where(eq(btsHouseTermAliasesTable.id, id))
      .returning();

    await refreshHouseTermAliasCache();
    logAdminAction(req, "update", "bts_house_term_alias", String(id), `Updated house-term alias "${current.misspelling}"`, update);
    return res.json({ alias: row });
  } catch (err) {
    console.error("[house-terms] update failed:", err);
    return res.status(500).json({ error: "Failed to update house-term alias" });
  }
});

// ── Delete an alias override ─────────────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const [current] = await db.select().from(btsHouseTermAliasesTable).where(eq(btsHouseTermAliasesTable.id, id)).limit(1);
    if (!current) return res.status(404).json({ error: "Alias not found" });

    await db.delete(btsHouseTermAliasesTable).where(eq(btsHouseTermAliasesTable.id, id));
    await refreshHouseTermAliasCache();
    logAdminAction(req, "delete", "bts_house_term_alias", String(id), `Deleted house-term alias "${current.misspelling}"`);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[house-terms] delete failed:", err);
    return res.status(500).json({ error: "Failed to delete house-term alias" });
  }
});

export default router;
