import { Router, type IRouter } from "express";
import { db, aiLiveDocumentsTable, kbStagingDocsTable } from "@workspace/db";
import { eq, and, desc, sql, inArray, isNull, isNotNull } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac";
import { scrubPrivateContent } from "../../lib/content-privacy-filter";
import { getParam } from "../../lib/params";
import {
  synthesizeNode,
  isSynthesisRunning,
  isValidSynthesisNode,
} from "../../lib/kb-synthesis.js";
import { runTriageBackground } from "../../lib/kb-triage.js";
import { scanCoreTrainingSourceChanges } from "../../lib/kb-source-change-scan.js";
import { embedLiveDocumentInBackground, CLEARED_EMBEDDING_FIELDS } from "../../lib/kb-embeddings.js";

// Lifecycle management for the "Live AI Documents" corpus — the assistant's
// citable set (Task #1665). Mounted at /admin/ai-live-documents. Reads/writes
// ONLY the ai_live_documents table.
//
// The corpus is READ-MOSTLY: the intended edit path is the human-gated review
// loop (send-to-review → review queue → push-approved supersede), which snapshots
// version history. Direct PUT edits remain as a clearly-labelled, confirmation-
// gated admin escape hatch. Deletes are SOFT (reversible); nothing is ever
// hard-deleted.
const router: IRouter = Router();

const chunkCount = (content: string) => Math.ceil(content.length / 500);

router.get("/admin/ai-live-documents", requirePermission("chat:view"), async (req, res): Promise<void> => {
  const category = req.query.category as string | undefined;
  const search = req.query.search as string | undefined;
  // By default the admin list shows only LIVE docs. `?deleted=true` returns the
  // soft-deleted "trash" view so an admin can review and restore.
  const showDeleted = req.query.deleted === "true";

  const conditions: any[] = [];

  conditions.push(showDeleted ? isNotNull(aiLiveDocumentsTable.deletedAt) : isNull(aiLiveDocumentsTable.deletedAt));

  if (category) {
    conditions.push(eq(aiLiveDocumentsTable.category, category));
  }

  // Blended relevance search: OR-style tsquery (any word can match) with a
  // pg_trgm fuzzy fallback for close/misspelled queries. Mirrors the existing
  // knowledgebase admin search.
  const orTsquery = search
    ? sql`(
        SELECT COALESCE(
          NULLIF(
            (SELECT to_tsquery('english', string_agg(lexeme, ' | '))
             FROM unnest(to_tsvector('english', ${search}))),
            NULL
          ),
          plainto_tsquery('english', ${search})
        )
      )`
    : null;

  if (search && orTsquery) {
    conditions.push(
      sql`(
        to_tsvector('english', ${aiLiveDocumentsTable.title} || ' ' || ${aiLiveDocumentsTable.content}) @@ ${orTsquery}
        OR similarity(${aiLiveDocumentsTable.title}, ${search}) > 0.15
        OR word_similarity(${search}, ${aiLiveDocumentsTable.title}) > 0.2
        OR word_similarity(${search}, ${aiLiveDocumentsTable.content}) > 0.15
      )`
    );
  }

  const orderBy =
    search && orTsquery
      ? sql`GREATEST(
          ts_rank(
            setweight(to_tsvector('english', ${aiLiveDocumentsTable.title}), 'A') ||
              setweight(to_tsvector('english', ${aiLiveDocumentsTable.content}), 'B'),
            ${orTsquery}
          ),
          similarity(${aiLiveDocumentsTable.title}, ${search}),
          word_similarity(${search}, ${aiLiveDocumentsTable.title}),
          word_similarity(${search}, ${aiLiveDocumentsTable.content})
        ) DESC`
      : desc(aiLiveDocumentsTable.updatedAt);

  const docs = await db
    .select()
    .from(aiLiveDocumentsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(orderBy);

  res.json(docs.map((d) => ({ ...d, chunkCount: chunkCount(d.content) })));
});

router.post("/admin/ai-live-documents", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const { title, category, content, slug } = req.body as { title?: string; category?: string; content?: string; slug?: string };

  if (!title || !content) {
    res.status(400).json({ error: "Title and content are required" });
    return;
  }

  const trimmedSlug = slug?.trim();

  try {
    const [doc] = await db
      .insert(aiLiveDocumentsTable)
      .values({
        title: scrubPrivateContent(title),
        category: category || "faq",
        content: scrubPrivateContent(content),
        slug: trimmedSlug ? trimmedSlug : null,
      })
      .returning();

    // Semantic embedding (Task #1803): fire-and-forget; on failure the doc
    // stays lexical-only until the boot backfill retries it.
    embedLiveDocumentInBackground(doc.id);

    res.status(201).json({ ...doc, chunkCount: chunkCount(doc.content) });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "A document with that slug already exists" });
      return;
    }
    throw err;
  }
});

// Direct edit — the ADMIN ESCAPE HATCH. The primary edit path is send-to-review
// (below); this bypasses the review loop and version snapshot, so the client
// gates it behind an explicit confirmation.
router.put("/admin/ai-live-documents/:id", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(getParam(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [existing] = await db.select().from(aiLiveDocumentsTable).where(eq(aiLiveDocumentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const { title, category, content, slug } = req.body as { title?: string; category?: string; content?: string; slug?: string };

  const updates: Record<string, any> = {};
  if (title !== undefined) updates.title = scrubPrivateContent(title);
  if (category !== undefined) updates.category = category;
  if (content !== undefined) updates.content = scrubPrivateContent(content);
  if (slug !== undefined) {
    const trimmedSlug = slug.trim();
    updates.slug = trimmedSlug ? trimmedSlug : null;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  // Title/content change invalidates the semantic vector — clear it ATOMICALLY
  // with the edit so a failed re-embed degrades to lexical-only, never stale.
  const contentChanged = updates.title !== undefined || updates.content !== undefined;
  if (contentChanged) Object.assign(updates, CLEARED_EMBEDDING_FIELDS);

  try {
    const [updated] = await db
      .update(aiLiveDocumentsTable)
      .set(updates)
      .where(eq(aiLiveDocumentsTable.id, id))
      .returning();

    // Re-embed after a direct edit: fire-and-forget. The stale vector was
    // already cleared atomically above, so a failure here = lexical-only.
    if (contentChanged) {
      embedLiveDocumentInBackground(updated.id);
    }

    res.json({ ...updated, chunkCount: chunkCount(updated.content) });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "A document with that slug already exists" });
      return;
    }
    throw err;
  }
});

// Manual "send back to review" — the primary edit trigger. Creates a revision
// draft in the staging queue (kb_staging_docs) linked to this live doc via
// update_kind='update' + target_live_doc_id, seeded with the doc's CURRENT
// content so the reviewer edits from the live version. It then flows through the
// existing review → push-approved supersede path (which snapshots version
// history). Non-destructive: the live doc is untouched until an approval is
// pushed.
router.post("/admin/ai-live-documents/:id/send-to-review", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(getParam(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [doc] = await db.select().from(aiLiveDocumentsTable).where(eq(aiLiveDocumentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (doc.deletedAt) {
    res.status(409).json({ error: "Cannot send a deleted document to review; restore it first" });
    return;
  }

  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";

  // Avoid piling up duplicate open revision drafts for the same live doc.
  const [openDraft] = await db
    .select({ id: kbStagingDocsTable.id })
    .from(kbStagingDocsTable)
    .where(and(
      eq(kbStagingDocsTable.targetLiveDocId, id),
      eq(kbStagingDocsTable.updateKind, "update"),
      inArray(kbStagingDocsTable.status, ["pending_review", "needs_review", "processing"]),
    ))
    .limit(1);
  if (openDraft) {
    res.status(409).json({ error: "This document already has an open revision in the review queue", draftId: openDraft.id });
    return;
  }

  const [draft] = await db
    .insert(kbStagingDocsTable)
    .values({
      title: doc.title,
      category: doc.category,
      content: doc.content,
      audience: doc.audience,
      status: "needs_review",
      docType: "existing_doc",
      originType: "manual_entry",
      docClassTarget: doc.docClass ?? "curated",
      homeRoot: doc.homeRoot ?? null,
      node: doc.node ?? null,
      ceiling: doc.ceiling ?? null,
      handoff: doc.handoff ?? null,
      updateKind: "update",
      targetLiveDocId: id,
      updateSummary:
        (note ? note + "\n\n" : "") +
        "Manually sent back to review from Live AI Documents. Edit and approve to supersede the live version.",
    })
    .returning({ id: kbStagingDocsTable.id });

  res.status(201).json({ success: true, draftId: draft.id });
});

// Soft-delete (reversible). Sets the tombstone so the doc drops out of every
// retrieval path, but preserves the row + its version history for restore.
router.delete("/admin/ai-live-documents/:id", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(getParam(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [existing] = await db.select().from(aiLiveDocumentsTable).where(eq(aiLiveDocumentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (existing.deletedAt) {
    res.json({ success: true, alreadyDeleted: true });
    return;
  }

  await db
    .update(aiLiveDocumentsTable)
    .set({ deletedAt: new Date() })
    .where(eq(aiLiveDocumentsTable.id, id));

  res.json({ success: true });
});

// Restore a soft-deleted doc back into the live/citable corpus.
router.post("/admin/ai-live-documents/:id/restore", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(getParam(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [existing] = await db.select().from(aiLiveDocumentsTable).where(eq(aiLiveDocumentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const [restored] = await db
    .update(aiLiveDocumentsTable)
    .set({ deletedAt: null })
    .where(eq(aiLiveDocumentsTable.id, id))
    .returning();

  // A restored doc may predate the semantic layer — ensure it has an embedding.
  embedLiveDocumentInBackground(restored.id);

  res.json({ ...restored, chunkCount: chunkCount(restored.content) });
});

// On-demand "source changed" scan (Task #1665). Reuses the core-training source
// change detection and STAMPS a persistent stale flag on every published live
// doc whose topic node is fed by a materially-changed source, so the admin UI
// can badge it "likely needs updating" (survives reloads). Human-gated: it only
// flags — proposing/approving a revision stays a separate, explicit action.
router.post("/admin/ai-live-documents/scan-source-changes", requirePermission("chat:manage"), async (_req, res): Promise<void> => {
  try {
    const scan = await scanCoreTrainingSourceChanges();

    let flaggedDocIds: number[] = [];
    if (scan.affectedNodes.length > 0) {
      const materialTitles = scan.material.map((m) => m.title);
      const reason =
        `Linked source material changed (${new Date().toISOString().slice(0, 10)})` +
        (materialTitles.length > 0 ? `: ${materialTitles.slice(0, 5).join("; ")}${materialTitles.length > 5 ? "; …" : ""}` : "") +
        ". Review whether this document needs updating.";
      const flagged = await db
        .update(aiLiveDocumentsTable)
        .set({ flaggedStaleAt: new Date(), flaggedReason: reason })
        .where(and(
          isNull(aiLiveDocumentsTable.deletedAt),
          inArray(aiLiveDocumentsTable.node, scan.affectedNodes),
          sql`${aiLiveDocumentsTable.docClass} IN ('curated','overview')`,
          isNotNull(aiLiveDocumentsTable.lastVerified),
        ))
        .returning({ id: aiLiveDocumentsTable.id });
      flaggedDocIds = flagged.map((f) => f.id);
    }

    res.json({
      scanned: scan.scanned,
      changed: scan.changed.length,
      material: scan.material.length,
      affectedNodes: scan.affectedNodes,
      flaggedDocIds,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Source-change scan failed" });
  }
});

// Clear the stale flag without proposing an update (admin dismisses the signal).
router.post("/admin/ai-live-documents/:id/dismiss-flag", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(getParam(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }
  const [updated] = await db
    .update(aiLiveDocumentsTable)
    .set({ flaggedStaleAt: null, flaggedReason: null })
    .where(eq(aiLiveDocumentsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json({ ...updated, chunkCount: chunkCount(updated.content) });
});

// Propose an update for a (typically flagged) doc: re-synthesize its topic node
// through the EXISTING supersede path, which authors an update draft
// (update_kind='update', target_live_doc_id) into the review queue. Human-gated:
// this only creates a draft — the flag clears when an approval is pushed.
router.post("/admin/ai-live-documents/:id/propose-update", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(getParam(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [doc] = await db.select().from(aiLiveDocumentsTable).where(eq(aiLiveDocumentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (!doc.node || !isValidSynthesisNode(doc.node)) {
    res.status(400).json({ error: "This document has no synthesizable topic node; use 'Send to Review' instead" });
    return;
  }
  if (isSynthesisRunning()) {
    res.status(409).json({ error: "A synthesis run is already in progress; try again shortly" });
    return;
  }

  try {
    const result = await synthesizeNode(doc.node);
    const newDraftIds = [
      ...(result.draftId ? [result.draftId] : []),
      ...result.atomicDraftIds,
    ];
    if (newDraftIds.length > 0) {
      const drafts = await db
        .select()
        .from(kbStagingDocsTable)
        .where(inArray(kbStagingDocsTable.id, newDraftIds));
      if (drafts.length > 0) {
        runTriageBackground(drafts).catch((err) =>
          console.error("[ai-live-documents] propose-update triage error:", err),
        );
      }
    }
    res.json({ success: true, ...result });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Synthesis failed" });
  }
});

export default router;
