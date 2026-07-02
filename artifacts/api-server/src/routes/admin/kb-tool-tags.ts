import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { kbToolTagsTable, kbProposedToolTagsTable } from "@workspace/db/schema";
import { eq, desc, asc, sql } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac.js";
import { logAdminAction } from "../../lib/audit-log.js";
import {
  refreshToolTagCache,
  slugifyToolName,
  getEffectiveTags,
} from "../../lib/kb-tool-tags.js";
import { CONCEPT_TAGS, TROUBLESHOOTING_TAG } from "../../lib/kb-taxonomy.js";

const router = Router();
router.use(requirePermission("chat:manage"));

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Coerce an unknown body value into a clean, deduped list of trigger phrases. */
function cleanTriggers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const t of value) {
    const s = typeof t === "string" ? t.trim().toLowerCase() : "";
    if (s) seen.add(s);
  }
  return [...seen];
}

// ── List: tool tags + pending proposals + the read-only code tags ────────────
router.get("/", async (_req: Request, res: Response) => {
  try {
    const [toolTags, proposals] = await Promise.all([
      db.select().from(kbToolTagsTable).orderBy(asc(kbToolTagsTable.slug)),
      db
        .select()
        .from(kbProposedToolTagsTable)
        .where(eq(kbProposedToolTagsTable.status, "pending"))
        .orderBy(desc(kbProposedToolTagsTable.occurrenceCount), desc(kbProposedToolTagsTable.lastSeenAt)),
    ]);
    res.json({
      toolTags,
      proposals,
      // Code-defined vocabulary (read-only context — not DB-managed).
      conceptTags: [...CONCEPT_TAGS],
      troubleshootingTag: TROUBLESHOOTING_TAG,
      effectiveTags: getEffectiveTags(),
    });
  } catch (err) {
    console.error("[kb-tool-tags] list failed:", err);
    res.status(500).json({ error: "Failed to load tool tags" });
  }
});

// ── Create a tool tag ────────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  try {
    const rawSlug = typeof req.body.slug === "string" && req.body.slug.trim()
      ? req.body.slug.trim().toLowerCase()
      : slugifyToolName(String(req.body.label ?? ""));
    const label = typeof req.body.label === "string" ? req.body.label.trim() : "";
    if (!rawSlug || !SLUG_RE.test(rawSlug)) {
      return res.status(400).json({ error: "Slug must be lowercase letters, numbers and hyphens" });
    }
    if (!label) return res.status(400).json({ error: "Label is required" });

    const existing = await db
      .select({ id: kbToolTagsTable.id })
      .from(kbToolTagsTable)
      .where(eq(kbToolTagsTable.slug, rawSlug))
      .limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: `Tag "${rawSlug}" already exists` });
    }

    const [row] = await db
      .insert(kbToolTagsTable)
      .values({
        slug: rawSlug,
        label,
        triggers: cleanTriggers(req.body.triggers),
        enabled: req.body.enabled === false ? false : true,
        protected: false,
        source: "admin",
        createdBy: req.userId ?? null,
      })
      .returning();

    await refreshToolTagCache();
    logAdminAction(req, "create", "kb_tool_tag", String(row.id), `Created tool tag "${rawSlug}"`);
    return res.status(201).json({ toolTag: row });
  } catch (err) {
    console.error("[kb-tool-tags] create failed:", err);
    return res.status(500).json({ error: "Failed to create tool tag" });
  }
});

// ── Edit a tool tag (label / triggers / enabled) ─────────────────────────────
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const [current] = await db.select().from(kbToolTagsTable).where(eq(kbToolTagsTable.id, id)).limit(1);
    if (!current) return res.status(404).json({ error: "Tool tag not found" });

    const update: Partial<typeof kbToolTagsTable.$inferInsert> = {};
    if (typeof req.body.label === "string" && req.body.label.trim()) update.label = req.body.label.trim();
    if (req.body.triggers !== undefined) update.triggers = cleanTriggers(req.body.triggers);
    if (req.body.enabled !== undefined) {
      const enabled = req.body.enabled !== false;
      // Protected tags (ad-publisher code names) can never be disabled.
      if (!enabled && current.protected) {
        return res.status(400).json({ error: "Protected tags cannot be disabled" });
      }
      update.enabled = enabled;
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const [row] = await db
      .update(kbToolTagsTable)
      .set(update)
      .where(eq(kbToolTagsTable.id, id))
      .returning();

    await refreshToolTagCache();
    logAdminAction(req, "update", "kb_tool_tag", String(id), `Updated tool tag "${current.slug}"`, update);
    return res.json({ toolTag: row });
  } catch (err) {
    console.error("[kb-tool-tags] update failed:", err);
    return res.status(500).json({ error: "Failed to update tool tag" });
  }
});

// ── Delete a tool tag (protected tags are undeletable) ───────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const [current] = await db.select().from(kbToolTagsTable).where(eq(kbToolTagsTable.id, id)).limit(1);
    if (!current) return res.status(404).json({ error: "Tool tag not found" });
    if (current.protected) return res.status(400).json({ error: "Protected tags cannot be deleted" });

    await db.delete(kbToolTagsTable).where(eq(kbToolTagsTable.id, id));
    await refreshToolTagCache();
    logAdminAction(req, "delete", "kb_tool_tag", String(id), `Deleted tool tag "${current.slug}"`);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[kb-tool-tags] delete failed:", err);
    return res.status(500).json({ error: "Failed to delete tool tag" });
  }
});

// ── Approve a proposal → promote to a live tool tag ──────────────────────────
router.post("/proposals/:id/approve", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const [proposal] = await db
      .select()
      .from(kbProposedToolTagsTable)
      .where(eq(kbProposedToolTagsTable.id, id))
      .limit(1);
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });
    if (proposal.status !== "pending") {
      return res.status(400).json({ error: `Proposal already ${proposal.status}` });
    }

    // Reviewer may override the slug/label/triggers at approval time.
    const slug = typeof req.body.slug === "string" && req.body.slug.trim()
      ? req.body.slug.trim().toLowerCase()
      : proposal.slug;
    const label = typeof req.body.label === "string" && req.body.label.trim()
      ? req.body.label.trim()
      : proposal.label;
    const triggers = req.body.triggers !== undefined
      ? cleanTriggers(req.body.triggers)
      : (proposal.suggestedTriggers ?? []);
    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({ error: "Slug must be lowercase letters, numbers and hyphens" });
    }

    const existing = await db
      .select({ id: kbToolTagsTable.id })
      .from(kbToolTagsTable)
      .where(eq(kbToolTagsTable.slug, slug))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(kbToolTagsTable).values({
        slug,
        label,
        triggers,
        enabled: true,
        protected: false,
        source: "ai_approved",
        createdBy: req.userId ?? null,
      });
    }

    await db
      .update(kbProposedToolTagsTable)
      .set({ status: "approved", reviewedBy: req.userId ?? null, reviewedAt: new Date() })
      .where(eq(kbProposedToolTagsTable.id, id));

    await refreshToolTagCache();
    logAdminAction(req, "approve", "kb_proposed_tool_tag", String(id), `Approved tool tag "${slug}"`);
    return res.json({ ok: true, slug });
  } catch (err) {
    console.error("[kb-tool-tags] approve failed:", err);
    return res.status(500).json({ error: "Failed to approve proposal" });
  }
});

// ── Reject a proposal ────────────────────────────────────────────────────────
router.post("/proposals/:id/reject", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const [proposal] = await db
      .select()
      .from(kbProposedToolTagsTable)
      .where(eq(kbProposedToolTagsTable.id, id))
      .limit(1);
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });
    if (proposal.status !== "pending") {
      return res.status(400).json({ error: `Proposal already ${proposal.status}` });
    }

    await db
      .update(kbProposedToolTagsTable)
      .set({ status: "rejected", reviewedBy: req.userId ?? null, reviewedAt: new Date() })
      .where(eq(kbProposedToolTagsTable.id, id));

    logAdminAction(req, "reject", "kb_proposed_tool_tag", String(id), `Rejected tool tag "${proposal.slug}"`);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[kb-tool-tags] reject failed:", err);
    return res.status(500).json({ error: "Failed to reject proposal" });
  }
});

export default router;
