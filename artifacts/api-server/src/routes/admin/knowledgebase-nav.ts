/**
 * Navigation Docs admin API (Task #1776).
 *
 * Screenshot-driven authoring of `navigation`-class walkthrough docs plus the
 * advisory nav-gap flag review surface. Drafting rides the EXISTING staging →
 * review → push-to-live → supersede pipeline: this router only ever creates
 * kb_staging_docs rows in `needs_review` — the human gate (approve + push on
 * the AI Document Review page) is absolute and lives elsewhere.
 *
 * Endpoints (all behind chat:manage):
 *  - GET  /apps                 fixed tiered app vocabulary (+ per-app coverage)
 *  - GET  /docs                 nav-class docs across staging + live
 *  - GET  /gaps                 nav-gap flags (?includeClosed=1&app=slug)
 *  - POST /gaps/:id/dismiss     sticky dismissal
 *  - POST /gaps/:id/reopen      manual re-open
 *  - POST /gaps/merge           { sourceId, targetId } merge duplicate areas
 *  - POST /draft                vision-model draft from uploaded screenshots
 */

import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { kbStagingDocsTable, aiLiveDocumentsTable } from "@workspace/db/schema";
import { eq, desc, asc, sql, and, isNull, isNotNull } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac.js";
import { getParam } from "../../lib/params";
import {
  NAV_APPS,
  resolveNavApp,
  normalizeNavArea,
} from "../../lib/kb-nav-vocabulary.js";
import {
  listNavGapFlags,
  dismissNavGapFlag,
  reopenNavGapFlag,
  mergeNavGapFlags,
} from "../../lib/kb-nav-gaps.js";
import { ObjectStorageService, ObjectNotFoundError } from "../../lib/objectStorage.js";

const router = Router();
router.use(requirePermission("chat:manage"));

const MAX_SCREENSHOTS = 8;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024; // 8 MB each

// ── Vocabulary + coverage ───────────────────────────────────────────────────

router.get("/apps", async (_req: Request, res: Response) => {
  try {
    // Published-coverage rollup: which (app, area) pairs already have a live,
    // verified navigation doc.
    const live = await db
      .select({
        navApp: aiLiveDocumentsTable.navApp,
        navArea: aiLiveDocumentsTable.navArea,
      })
      .from(aiLiveDocumentsTable)
      .where(and(
        eq(aiLiveDocumentsTable.docClass, "navigation"),
        isNotNull(aiLiveDocumentsTable.navApp),
        isNotNull(aiLiveDocumentsTable.lastVerified),
        isNull(aiLiveDocumentsTable.deletedAt),
      ));
    const coverage = new Map<string, string[]>();
    for (const row of live) {
      if (!row.navApp) continue;
      const areas = coverage.get(row.navApp) ?? [];
      areas.push(normalizeNavArea(row.navArea));
      coverage.set(row.navApp, areas);
    }
    res.json({
      apps: NAV_APPS.map((a) => ({
        slug: a.slug,
        label: a.label,
        tier: a.tier,
        suggestedAreas: a.suggestedAreas,
        coveredAreas: [...new Set(coverage.get(a.slug) ?? [])],
      })),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Nav-class docs across the pipeline ──────────────────────────────────────

router.get("/docs", async (_req: Request, res: Response) => {
  try {
    const staging = await db
      .select({
        id: kbStagingDocsTable.id,
        title: kbStagingDocsTable.title,
        status: kbStagingDocsTable.status,
        navApp: kbStagingDocsTable.navApp,
        navArea: kbStagingDocsTable.navArea,
        navScreenshots: kbStagingDocsTable.navScreenshots,
        updateKind: kbStagingDocsTable.updateKind,
        targetLiveDocId: kbStagingDocsTable.targetLiveDocId,
        createdAt: kbStagingDocsTable.createdAt,
      })
      .from(kbStagingDocsTable)
      .where(and(
        eq(kbStagingDocsTable.docClassTarget, "navigation"),
        sql`${kbStagingDocsTable.status} NOT IN ('published','rejected')`,
      ))
      .orderBy(desc(kbStagingDocsTable.createdAt));

    const live = await db
      .select({
        id: aiLiveDocumentsTable.id,
        title: aiLiveDocumentsTable.title,
        navApp: aiLiveDocumentsTable.navApp,
        navArea: aiLiveDocumentsTable.navArea,
        lastVerified: aiLiveDocumentsTable.lastVerified,
        updatedAt: aiLiveDocumentsTable.updatedAt,
      })
      .from(aiLiveDocumentsTable)
      .where(and(
        eq(aiLiveDocumentsTable.docClass, "navigation"),
        isNull(aiLiveDocumentsTable.deletedAt),
      ))
      // Staleness-first: grouped per app, oldest verified date first so stale
      // apps/docs surface at the top of each app group.
      .orderBy(
        asc(aiLiveDocumentsTable.navApp),
        sql`${aiLiveDocumentsTable.lastVerified} ASC NULLS FIRST`,
      );

    res.json({ staging, live });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Nav-gap flags ───────────────────────────────────────────────────────────

router.get("/gaps", async (req: Request, res: Response) => {
  try {
    const includeClosed = req.query.includeClosed === "1" || req.query.includeClosed === "true";
    const app = typeof req.query.app === "string" && req.query.app ? req.query.app : undefined;
    const flags = await listNavGapFlags({ includeClosed, app });
    res.json({ flags });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/gaps/:id/dismiss", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const adminUserId = (req as unknown as { userId: number }).userId;
    const flag = await dismissNavGapFlag(id, adminUserId);
    if (!flag) {
      res.status(404).json({ error: "Flag not found" });
      return;
    }
    res.json({ flag });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/gaps/:id/reopen", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    const flag = await reopenNavGapFlag(id);
    if (!flag) {
      res.status(404).json({ error: "Flag not found" });
      return;
    }
    res.json({ flag });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/gaps/merge", async (req: Request, res: Response) => {
  try {
    const { sourceId, targetId } = req.body as { sourceId?: number; targetId?: number };
    if (!sourceId || !targetId || typeof sourceId !== "number" || typeof targetId !== "number") {
      res.status(400).json({ error: "sourceId and targetId are required" });
      return;
    }
    const merged = await mergeNavGapFlags(sourceId, targetId);
    if (!merged) {
      res.status(404).json({ error: "Flag not found (or sourceId === targetId)" });
      return;
    }
    res.json({ flag: merged });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Vision drafting ─────────────────────────────────────────────────────────

/** Download an uploaded screenshot from private object storage as a data URL. */
async function screenshotToDataUrl(objectPath: string): Promise<string> {
  const storage = new ObjectStorageService();
  const file = await storage.getObjectEntityFile(objectPath);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);
  if (size > MAX_SCREENSHOT_BYTES) {
    throw new Error(`Screenshot ${objectPath} exceeds the ${MAX_SCREENSHOT_BYTES / 1024 / 1024}MB limit`);
  }
  const contentType = typeof metadata.contentType === "string" && metadata.contentType.startsWith("image/")
    ? metadata.contentType
    : "image/png";
  const [buffer] = await file.download();
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function buildNavDraftSystemPrompt(appLabel: string, area: string): string {
  return `You write member-facing NAVIGATION WALKTHROUGH documents for the BTS (Build Test Scale) affiliate-marketing member portal's AI knowledgebase.

You are given ordered UI screenshots of "${appLabel}" covering the area "${area}", plus optional admin notes. Write ONE walkthrough doc that tells a member exactly how to perform the task shown, step by step.

RULES:
- Describe ONLY what is visible in the screenshots or stated in the notes. NEVER invent menu names, buttons, prices, limits or settings you cannot see.
- Number the steps. Reference concrete UI labels in quotes (e.g. click "Save & Continue").
- If a step is ambiguous from the screenshots, say so explicitly ("(verify the exact label)") instead of guessing — a human reviewer will fix it.
- Keep it tight: a short one-sentence purpose line, then the numbered steps, then (only if visible) a short "What you should see" confirmation line.
- Plain text / simple markdown. No preamble, no closing pleasantries.

Return STRICT JSON: {"title": string, "content": string, "summary": string} where title is "<App>: <task>" (max 90 chars) and summary is one sentence for the review queue.`;
}

router.post("/draft", async (req: Request, res: Response) => {
  try {
    const { app, area, notes, screenshotPaths, targetLiveDocId } = req.body as {
      app?: string;
      area?: string;
      notes?: string;
      screenshotPaths?: string[];
      targetLiveDocId?: number;
    };

    const navApp = resolveNavApp(app);
    if (!navApp) {
      res.status(400).json({ error: "Unknown app — must be one of the fixed navigation vocabulary" });
      return;
    }
    const navArea = normalizeNavArea(area);
    const paths = Array.isArray(screenshotPaths) ? screenshotPaths.filter((p) => typeof p === "string" && p.startsWith("/objects/")) : [];
    if (paths.length === 0) {
      res.status(400).json({ error: "At least one uploaded screenshot is required" });
      return;
    }
    if (paths.length > MAX_SCREENSHOTS) {
      res.status(400).json({ error: `At most ${MAX_SCREENSHOTS} screenshots per draft` });
      return;
    }

    // Revision path must target an existing live NAVIGATION doc.
    let updateKind: string | null = null;
    if (targetLiveDocId) {
      const [target] = await db
        .select({ id: aiLiveDocumentsTable.id, docClass: aiLiveDocumentsTable.docClass })
        .from(aiLiveDocumentsTable)
        .where(and(eq(aiLiveDocumentsTable.id, targetLiveDocId), isNull(aiLiveDocumentsTable.deletedAt)));
      if (!target || target.docClass !== "navigation") {
        res.status(400).json({ error: "targetLiveDocId must reference a live navigation doc" });
        return;
      }
      updateKind = "update";
    }

    const base = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!base || !key) {
      res.status(503).json({ error: "AI integration is not configured" });
      return;
    }

    // Download screenshots (private bucket — the AI proxy can't reach them, so
    // we inline base64 data URLs).
    let imageUrls: string[];
    try {
      imageUrls = await Promise.all(paths.map((p) => screenshotToDataUrl(p)));
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(400).json({ error: "One or more screenshots were not found in storage" });
        return;
      }
      throw err;
    }

    const userContent: Array<Record<string, unknown>> = [
      {
        type: "text",
        text:
          `App: ${navApp.label}\nArea: ${navArea}\n` +
          (notes && typeof notes === "string" && notes.trim() ? `Admin notes:\n${notes.trim()}\n` : "") +
          `Screenshots follow in order.`,
      },
      ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
    ];

    const resp = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5",
        messages: [
          { role: "system", content: buildNavDraftSystemPrompt(navApp.label, navArea) },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        // gpt-5 burns reasoning tokens out of this budget — keep generous headroom.
        max_completion_tokens: 8000,
      }),
      signal: AbortSignal.timeout(180000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Vision drafting call failed: ${resp.status} ${body.slice(0, 300)}`);
    }
    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!raw) throw new Error("Vision model returned empty content");

    let parsed: { title?: string; content?: string; summary?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Vision model returned unparseable output — try again");
    }
    const title = (parsed.title ?? "").trim().slice(0, 200) || `${navApp.label}: ${navArea} walkthrough`;
    const content = (parsed.content ?? "").trim();
    if (!content) throw new Error("Vision model returned an empty walkthrough");

    // Draft ALWAYS lands in staging as needs_review — the human gate is absolute.
    const [draft] = await db
      .insert(kbStagingDocsTable)
      .values({
        title,
        content,
        category: "Navigation",
        status: "needs_review",
        originType: "manual_entry",
        source: "navigation_docs_admin",
        homeRoot: "operations",
        node: "navigation",
        docClassTarget: "navigation",
        navApp: navApp.slug,
        navArea,
        navScreenshots: paths,
        adminNotes: parsed.summary?.trim() || null,
        ...(updateKind && targetLiveDocId
          ? { updateKind, targetLiveDocId, updateSummary: `Screenshot-based revision drafted from ${paths.length} screenshot(s)` }
          : {}),
      })
      .returning();

    res.json({ draft });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[NavDocs] draft error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
