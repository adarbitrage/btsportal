/**
 * Synonym-gap proposal queue admin routes (Task #1804).
 *
 * Mirrors the kb-tool-tags proposal endpoints. IMPORTANT semantics: the live
 * synonym/alias layer is CODE (voice-synonyms.ts), so "approve" here is a
 * MARKER for a developer to fold the alias into the code map — approval never
 * changes live retrieval on its own.
 */

import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { kbProposedSynonymsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac.js";
import { logAdminAction } from "../../lib/audit-log.js";

const router = Router();
router.use(requirePermission("chat:manage"));

// ── List (pending first; recent decisions for context) ───────────────────────
router.get("/", async (_req: Request, res: Response) => {
  try {
    const proposals = await db
      .select()
      .from(kbProposedSynonymsTable)
      .orderBy(desc(kbProposedSynonymsTable.occurrenceCount), desc(kbProposedSynonymsTable.lastSeenAt));
    res.json({
      pending: proposals.filter((p) => p.status === "pending"),
      reviewed: proposals.filter((p) => p.status !== "pending").slice(0, 50),
    });
  } catch (err) {
    console.error("[kb-synonym-proposals] list failed:", err);
    res.status(500).json({ error: "Failed to load synonym proposals" });
  }
});

// ── Approve (marker only — a developer folds it into the code alias map) ─────
router.post("/:id/approve", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const [proposal] = await db
      .select()
      .from(kbProposedSynonymsTable)
      .where(eq(kbProposedSynonymsTable.id, id))
      .limit(1);
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });
    if (proposal.status !== "pending") {
      return res.status(400).json({ error: `Proposal already ${proposal.status}` });
    }

    await db
      .update(kbProposedSynonymsTable)
      .set({ status: "approved", reviewedBy: req.userId ?? null, reviewedAt: new Date() })
      .where(eq(kbProposedSynonymsTable.id, id));

    logAdminAction(
      req,
      "approve",
      "kb_proposed_synonym",
      String(id),
      `Approved synonym "${proposal.memberPhrase}" → "${proposal.canonicalTerm}" (code alias map change still required)`,
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("[kb-synonym-proposals] approve failed:", err);
    return res.status(500).json({ error: "Failed to approve proposal" });
  }
});

// ── Reject ────────────────────────────────────────────────────────────────────
router.post("/:id/reject", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const [proposal] = await db
      .select()
      .from(kbProposedSynonymsTable)
      .where(eq(kbProposedSynonymsTable.id, id))
      .limit(1);
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });
    if (proposal.status !== "pending") {
      return res.status(400).json({ error: `Proposal already ${proposal.status}` });
    }

    await db
      .update(kbProposedSynonymsTable)
      .set({ status: "rejected", reviewedBy: req.userId ?? null, reviewedAt: new Date() })
      .where(eq(kbProposedSynonymsTable.id, id));

    logAdminAction(req, "reject", "kb_proposed_synonym", String(id), `Rejected synonym "${proposal.memberPhrase}"`);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[kb-synonym-proposals] reject failed:", err);
    return res.status(500).json({ error: "Failed to reject proposal" });
  }
});

export default router;
