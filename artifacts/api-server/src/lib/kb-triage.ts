/**
 * KB Triage / Analysis Service (Task #2 — de-fanged).
 *
 * Previously this auto-APPROVED (and pushed live) or auto-REJECTED staging docs
 * based on an AI confidence score. That is gone: a member-facing truth doc is
 * NEVER published by a machine. Triage now only ANALYZES — it asks the model for
 * a cleaned title, a one-line summary and a suggested taxonomy, computes
 * human-readable risk flags (see kb-flags.ts), and always parks the doc in
 * `needs_review` for a human gate. Nothing here writes to knowledgebase_docs.
 *
 * Analysis events are still written to kbTriageAuditLogTable (INSERT-only) so
 * the history is preserved.
 */

import { db } from "@workspace/db";
import { kbStagingDocsTable, kbTriageAuditLogTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  computeRiskFlags,
  gatherFlagContext,
  maxSeverity,
  type RiskFlag,
} from "./kb-flags.js";
import {
  HOME_ROOTS,
  ALL_NODES,
  DOC_CLASSES,
} from "./kb-taxonomy.js";
import {
  getEffectiveTags,
  getEffectiveTagSet,
  recordProposedToolTag,
} from "./kb-tool-tags.js";

// ── Run-state flag (unified for manual and pipeline-triggered runs) ──────────

let _triageRunning = false;

export function isTriageRunning(): boolean {
  return _triageRunning;
}

// ── AI analysis prompt ────────────────────────────────────────────────────────

const NODE_LIST = ALL_NODES.map((n) => `${n.slug} (${n.root})`).join(", ");
const ROOT_LIST = HOME_ROOTS.map((r) => r.slug).join(" | ");

// The tag vocabulary is now the DB-backed EFFECTIVE vocabulary (admin-managed
// tool tags + code concept/troubleshooting tags), so the tag list is injected
// per-call rather than baked into a module const.
function buildTriagePrompt(tagList: string): string {
  return `You are a knowledge-base librarian for the BTS (Build Test Scale) affiliate-marketing coaching assistant.

You receive a DRAFT training document extracted from a transcript or coaching session. You do NOT decide whether to publish it — a human always does that. Your job is to suggest clean metadata so the human reviewer can work faster.

BTS BRAND RULES (note violations in "reasoning", do not silently fix):
- Must say "Build Test Scale" or "BTS" — never "TCE", "Cherrington", "Charrington"
- Coach surnames must not appear (Bobilev, Wissbaum, Rupp, Clark, Shepard)
- Adam's full name must not appear
- "support@buildtestscale.com" is the correct email

TAXONOMY:
- home root (pick ONE): ${ROOT_LIST}
- node (pick ONE that fits the home root): ${NODE_LIST}
- doc class (pick ONE): ${DOC_CLASSES.join(" | ")}
- tags (pick 0-4 from): ${tagList}

TIPS-AND-TRICKS RULE (short, tool-driven "tips and tricks" walkthroughs — e.g. Nano Banana, Grok Imagine, Anstrex ad copy, headline formulas — that show a member how to get one specific thing done, usually with a named piece of software):
- These are training source material. Keep doc class = "transcript" (training-only, non-citable) — never suggest "curated" or "overview" for a tip.
- Pick home root by intent: a REPEATABLE CAMPAIGN BUILD STEP (make/resize/animate/edit a creative, or a step in launching/tracking/testing/scaling a campaign) => home root "process", node USUALLY "creative-assets". A CROSS-CAMPAIGN SKILL or principle (how to write copy, choose angles, structure tests) => home root "concepts", node from: headlines-and-copy, creative-strategy, testing-methodology, angles.
- Rule of thumb: if the payoff is AN ASSET the member produced => process/creative-assets; if the payoff is A WAY OF WRITING OR THINKING they reuse => a concepts node.
- The specific SOFTWARE a tip uses is a TOOL TAG, never a node — never invent a node named after a tool. Put known tools in "suggestedTags" and any unknown tool in "observedTools".
- A tip may touch several nodes; suggest only the SINGLE DOMINANT node. Secondary links are added later at synthesis.

CATEGORIES (legacy field, pick one): curriculum | strategy | sop | faq | platform_guide

Respond ONLY with valid JSON (no markdown, no extra text):
{
  "cleanedTitle": <improved concise title, max 80 chars>,
  "summary": <one-sentence summary of what it teaches, max 150 chars>,
  "suggestedCategory": <one of the 5 categories>,
  "suggestedHomeRoot": <${ROOT_LIST}>,
  "suggestedNode": <a node slug from the list>,
  "suggestedDocClass": <${DOC_CLASSES.join(" | ")}>,
  "suggestedTags": <array of 0-4 tag slugs>,
  "observedTools": <array of names of any third-party or in-house SOFTWARE / TOOL / PLATFORM the document tells the member to use that is NOT already in the tag list above; plain names, [] if none>,
  "reasoning": <1-2 sentence note on quality / brand or privacy issues>
}`;
}

export interface TriageResult {
  suggestedCategory: string;
  cleanedTitle: string;
  summary: string;
  reasoning: string;
  suggestedHomeRoot: string | null;
  suggestedNode: string | null;
  suggestedDocClass: string | null;
  suggestedTags: string[];
}

const ROOT_SET = new Set(HOME_ROOTS.map((r) => r.slug));
const NODE_SET = new Set(ALL_NODES.map((n) => n.slug));
const DOC_CLASS_SET = new Set<string>(DOC_CLASSES as readonly string[]);

export async function triageDoc(doc: {
  title: string;
  content: string;
  editedContent?: string | null;
  source?: string | null;
  phase?: string | null;
  module?: string | null;
  lessonType?: string | null;
}): Promise<TriageResult> {
  const content = doc.editedContent ?? doc.content;
  const contextHint = doc.source === "blitz"
    ? `\n[Context: This is a Blitz curriculum doc. Phase: ${doc.phase || "unknown"}, Module: ${doc.module || "unknown"}, Type: ${doc.lessonType || "unknown"}]`
    : doc.source === "coaching_call"
    ? `\n[Context: This is a Coaching Call doc.]`
    : "";

  const userMessage = `Title: ${doc.title}${contextHint}\n\n${content.substring(0, 4000)}`;

  // Effective vocabulary (DB tool tags + code concept/troubleshooting tags),
  // read fresh per call so admin edits take effect with no deploy.
  const effectiveTags = getEffectiveTags();
  const tagSet = getEffectiveTagSet();

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
          { role: "system", content: buildTriagePrompt(effectiveTags.join(", ")) },
          { role: "user", content: userMessage },
        ],
        max_completion_tokens: 500,
      }),
      signal: AbortSignal.timeout(30000),
    },
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`AI triage error ${resp.status}: ${err.substring(0, 200)}`);
  }

  const json = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
  const raw = json.choices[0]?.message?.content ?? "";

  try {
    const parsed = JSON.parse(raw) as Partial<TriageResult> & {
      suggestedTags?: unknown;
      observedTools?: unknown;
    };
    const tags = Array.isArray(parsed.suggestedTags)
      ? parsed.suggestedTags.map(String).filter((t) => tagSet.has(t)).slice(0, 4)
      : [];
    // AI-proposes / human-approves queue: any tool/platform the model noticed
    // that isn't already in the effective vocabulary becomes a proposal (never a
    // live tag). Fire-and-forget so triage latency is unaffected.
    if (Array.isArray(parsed.observedTools)) {
      for (const name of parsed.observedTools.map(String)) {
        const trimmed = name.trim();
        if (trimmed) void recordProposedToolTag(trimmed, doc.title);
      }
    }
    const root = typeof parsed.suggestedHomeRoot === "string" && ROOT_SET.has(parsed.suggestedHomeRoot)
      ? parsed.suggestedHomeRoot
      : null;
    const node = typeof parsed.suggestedNode === "string" && NODE_SET.has(parsed.suggestedNode)
      ? parsed.suggestedNode
      : null;
    const docClass = typeof parsed.suggestedDocClass === "string" && DOC_CLASS_SET.has(parsed.suggestedDocClass)
      ? parsed.suggestedDocClass
      : null;
    return {
      suggestedCategory: parsed.suggestedCategory || "curriculum",
      cleanedTitle: (parsed.cleanedTitle || doc.title).substring(0, 80),
      summary: (parsed.summary || "").substring(0, 150),
      reasoning: parsed.reasoning || "",
      suggestedHomeRoot: root,
      suggestedNode: node,
      suggestedDocClass: docClass,
      suggestedTags: tags,
    };
  } catch {
    throw new Error(`Failed to parse triage response: ${raw.substring(0, 200)}`);
  }
}

// ── Analyze a single doc (no auto-action; always → needs_review) ──────────────

export interface AutoTriageDocResult {
  id: number;
  action: "analyzed";
  cleanedTitle: string;
  summary: string;
  flags: RiskFlag[];
}

export async function runAutoTriageOnDoc(
  doc: typeof kbStagingDocsTable.$inferSelect,
): Promise<AutoTriageDocResult> {
  const result = await triageDoc(doc);

  const ctx = await gatherFlagContext({ title: doc.title, aiCleanedTitle: result.cleanedTitle });
  const flags = computeRiskFlags({
    title: result.cleanedTitle || doc.title,
    content: doc.editedContent ?? doc.content,
    authorityRole: doc.authorityRole,
    docClassTarget: result.suggestedDocClass ?? doc.docClassTarget,
    homeRoot: result.suggestedHomeRoot ?? doc.homeRoot,
    corroborationCount: doc.corroborationCount ?? 0,
    duplicateTitle: ctx.duplicateTitle,
    conflictsWithVerified: ctx.conflictsWithVerified,
  });

  const conflictFlag = flags.find((f) => f.type === "conflict");
  const needsExpert = maxSeverity(flags) === "critical";

  const aiSuggestedTaxonomy = {
    homeRoot: result.suggestedHomeRoot,
    node: result.suggestedNode,
    docClass: result.suggestedDocClass,
    tags: result.suggestedTags,
    category: result.suggestedCategory,
  };

  await db
    .update(kbStagingDocsTable)
    .set({
      aiRecommendedAction: "needs_review",
      aiSuggestedCategory: result.suggestedCategory,
      aiCleanedTitle: result.cleanedTitle,
      aiSummary: result.summary,
      aiSuggestedTaxonomy,
      riskFlags: flags,
      needsExpert,
      conflictData: conflictFlag ? { message: conflictFlag.message, detail: conflictFlag.detail } : null,
      status: "needs_review" as typeof doc.status,
    })
    .where(eq(kbStagingDocsTable.id, doc.id));

  await db.insert(kbTriageAuditLogTable).values({
    stagingDocId: doc.id,
    eventType: "analyzed",
    confidenceScore: null,
    actorUserId: null,
    aiReasoning: result.reasoning,
    docTitle: doc.title,
  });

  return {
    id: doc.id,
    action: "analyzed",
    cleanedTitle: result.cleanedTitle,
    summary: result.summary,
    flags,
  };
}

// ── Undo a (legacy) auto-action ──────────────────────────────────────────────
//
// Kept for staging rows created before de-fanging that still carry an
// autoAction stamp. New analysis never sets autoAction, so this is a no-op for
// fresh docs. We append an 'undone' audit row and move the doc back to review.

export async function undoAutoAction(
  doc: typeof kbStagingDocsTable.$inferSelect,
  adminUserId: number,
): Promise<void> {
  if (!doc.autoAction) {
    throw new Error("Document has no auto-action to undo");
  }

  await db
    .update(kbStagingDocsTable)
    .set({
      status: "needs_review",
      reviewedBy: adminUserId,
      reviewedAt: new Date(),
    })
    .where(eq(kbStagingDocsTable.id, doc.id));

  await db.insert(kbTriageAuditLogTable).values({
    stagingDocId: doc.id,
    eventType: "undone",
    confidenceScore: doc.autoActionConfidence,
    actorUserId: adminUserId,
    aiReasoning: `Undone by admin (original action: ${doc.autoAction})`,
    docTitle: doc.title,
  });
}

// ── Background batch analysis (manages the shared run-state flag) ─────────────

export async function runTriageBackground(
  docs: (typeof kbStagingDocsTable.$inferSelect)[],
): Promise<{ analyzed: number; errors: number }> {
  if (_triageRunning) {
    console.log("[KB Triage] Already running — skipping duplicate invocation");
    return { analyzed: 0, errors: 0 };
  }

  _triageRunning = true;
  let analyzed = 0, errors = 0;

  console.log(`[KB Triage] Starting analysis on ${docs.length} documents`);

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    try {
      const result = await runAutoTriageOnDoc(doc);
      analyzed++;
      const sev = maxSeverity(result.flags);
      console.log(`[KB Triage] ${i + 1}/${docs.length}: analyzed (${result.flags.length} flag(s)${sev ? `, max ${sev}` : ""}) — ${result.cleanedTitle}`);
    } catch (err) {
      errors++;
      console.error(`[KB Triage] Error on doc ${doc.id} "${doc.title}":`, err instanceof Error ? err.message : err);
    }
    if (i < docs.length - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  _triageRunning = false;
  console.log(`[KB Triage] Done. analyzed=${analyzed}, errors=${errors}`);
  return { analyzed, errors };
}
