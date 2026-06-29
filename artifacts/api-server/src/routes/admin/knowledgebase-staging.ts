import { getParam } from "../../lib/params";
import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { kbStagingDocsTable, knowledgebaseDocsTable, kbDocProvenanceTable, kbTriageAuditLogTable } from "@workspace/db/schema";
import { eq, desc, sql, count, and, ne, isNotNull } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac.js";
import { scrubPrivateContent } from "../../lib/content-privacy-filter";
import {
  undoAutoAction,
  runTriageBackground,
  isTriageRunning,
} from "../../lib/kb-triage.js";
import { CITABLE_DOC_CLASSES } from "../../lib/kb-taxonomy.js";
import { detectLegacyRefs } from "../../lib/kb-mining.js";
import { blocksBulkConfirm, type RiskFlag } from "../../lib/kb-flags.js";

export { runTriageBackground } from "../../lib/kb-triage.js";

const router = Router();
router.use(requirePermission("chat:manage"));

router.get("/", async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || undefined;
    const search = (req.query.search as string) || undefined;
    const sourceFilter = (req.query.source as string) || undefined;
    const docTypeFilter = (req.query.docType as string) || undefined;
    const homeRootFilter = (req.query.homeRoot as string) || undefined;
    const page = parseInt((req.query.page as string) || "1");
    const limit = Math.min(parseInt((req.query.limit as string) || "20"), 100);
    const offset = (page - 1) * limit;

    let where = sql`1=1`;
    if (status) {
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
    if (sourceFilter === "coaching_call") {
      where = sql`${where} AND ${kbStagingDocsTable.source} = 'coaching_call'`;
    } else if (sourceFilter === "upload") {
      where = sql`${where} AND ${kbStagingDocsTable.source} = 'upload'`;
    } else if (sourceFilter === "unlabeled") {
      where = sql`${where} AND (${kbStagingDocsTable.source} IS NULL OR ${kbStagingDocsTable.source} NOT IN ('coaching_call','upload'))`;
    }

    const [docs, total] = await Promise.all([
      db
        .select()
        .from(kbStagingDocsTable)
        .where(where)
        .orderBy(desc(kbStagingDocsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ cnt: count() })
        .from(kbStagingDocsTable)
        .where(where),
    ]);

    const statusCounts = await db
      .select({
        status: kbStagingDocsTable.status,
        cnt: count(),
      })
      .from(kbStagingDocsTable)
      .groupBy(kbStagingDocsTable.status);

    const sourceCounts = await db
      .select({
        source: kbStagingDocsTable.source,
        cnt: count(),
      })
      .from(kbStagingDocsTable)
      .groupBy(kbStagingDocsTable.source);

    const docTypeCounts = await db
      .select({ docType: kbStagingDocsTable.docType, cnt: count() })
      .from(kbStagingDocsTable)
      .groupBy(kbStagingDocsTable.docType);

    const shelfCounts = await db
      .select({ homeRoot: kbStagingDocsTable.homeRoot, cnt: count() })
      .from(kbStagingDocsTable)
      .groupBy(kbStagingDocsTable.homeRoot);

    res.json({
      documents: docs,
      pagination: {
        page,
        limit,
        total: total[0].cnt,
        totalPages: Math.ceil(total[0].cnt / limit),
      },
      statusCounts: Object.fromEntries(
        statusCounts.map((s) => [s.status, s.cnt]),
      ),
      sourceCounts: {
        coaching_call: sourceCounts.find((s) => s.source === "coaching_call")?.cnt ?? 0,
        upload: sourceCounts.find((s) => s.source === "upload")?.cnt ?? 0,
        unlabeled: sourceCounts
          .filter((s) => !s.source || !["coaching_call", "upload"].includes(s.source ?? ""))
          .reduce((sum, s) => sum + s.cnt, 0),
      },
      docTypeCounts: Object.fromEntries(
        docTypeCounts.map((d) => [d.docType, d.cnt]),
      ),
      shelfCounts: shelfCounts
        .filter((s) => s.homeRoot)
        .map((s) => ({ homeRoot: s.homeRoot as string, count: s.cnt }))
        .sort((a, b) => b.count - a.count),
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

    const { ids, includeStatuses } = req.body as {
      ids?: number[];
      includeStatuses?: string[];
    };

    const statuses = includeStatuses ?? ["needs_review"];

    let targetDocs: (typeof kbStagingDocsTable.$inferSelect)[];

    if (ids && ids.length > 0) {
      targetDocs = await db
        .select()
        .from(kbStagingDocsTable)
        .where(sql`${kbStagingDocsTable.id} = ANY(${ids})`);
    } else {
      targetDocs = await db
        .select()
        .from(kbStagingDocsTable)
        .where(sql`${kbStagingDocsTable.status} = ANY(${statuses})`);
    }

    if (targetDocs.length === 0) {
      res.json({ message: "No documents to triage", triaged: 0 });
      return;
    }

    res.json({
      message: `Starting AI triage on ${targetDocs.length} documents in background.`,
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

router.get("/triage-status", async (_req: Request, res: Response) => {
  try {
    const [triaged, pending, needsReview] = await Promise.all([
      db.select({ cnt: count() }).from(kbStagingDocsTable).where(isNotNull(kbStagingDocsTable.aiRecommendedAction)),
      db.select({ cnt: count() }).from(kbStagingDocsTable).where(eq(kbStagingDocsTable.status, "needs_review")),
      db.select({ cnt: count() }).from(kbStagingDocsTable).where(eq(kbStagingDocsTable.status, "needs_review")),
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
    const { status, adminNotes, editedContent, title, category, tags } =
      req.body;

    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (adminNotes !== undefined) updates.adminNotes = adminNotes;
    if (editedContent !== undefined) updates.editedContent = editedContent;
    if (title) updates.title = title;
    if (category) updates.category = category;
    if (tags !== undefined) updates.tags = tags;

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
        .from(knowledgebaseDocsTable);
      res.json({
        message: "No approved documents to push",
        pushed: 0,
        totalInLiveKb,
      });
      return;
    }

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

        const [live] = await tx
          .insert(knowledgebaseDocsTable)
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
            lastVerified: sql`NOW()`,
          })
          .onConflictDoUpdate({
            target: knowledgebaseDocsTable.title,
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
              lastVerified: sql`NOW()`,
              updatedAt: sql`NOW()`,
            },
          })
          .returning({ id: knowledgebaseDocsTable.id });

        // Provenance: trace the published claim back to its screened source. We
        // refresh it on each push so re-publishing keeps a single accurate row.
        if (live) {
          await tx.delete(kbDocProvenanceTable).where(eq(kbDocProvenanceTable.docId, live.id));
          await tx.insert(kbDocProvenanceTable).values({
            docId: live.id,
            sourceId: doc.sourceId ?? null,
            chunkRef: doc.sourceVideoTitle ?? null,
            relation: "source",
          });
        }

        await tx
          .update(kbStagingDocsTable)
          .set({ status: "published" })
          .where(eq(kbStagingDocsTable.id, doc.id));
      }
    });

    const [{ cnt: totalInLiveKb }] = await db
      .select({ cnt: count() })
      .from(knowledgebaseDocsTable);

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
