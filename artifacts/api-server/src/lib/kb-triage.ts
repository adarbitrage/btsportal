/**
 * KB Triage Service
 *
 * Scores a staging doc with AI and decides whether to auto-approve,
 * auto-reject, or flag it as needs_review based on a configurable threshold.
 *
 * All auto-actions and undos are written to kbTriageAuditLogTable (INSERT-only)
 * so the full history is always preserved. Undo does NOT clear the autoAction
 * columns on the staging row — it appends an 'undone' audit record instead.
 */

import { db } from "@workspace/db";
import {
  kbStagingDocsTable,
  knowledgebaseDocsTable,
  systemSettingsTable,
  kbTriageAuditLogTable,
} from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { scrubPrivateContent } from "./content-privacy-filter";

// ── Run-state flag (unified for manual and pipeline-triggered runs) ──────────

let _triageRunning = false;

export function isTriageRunning(): boolean {
  return _triageRunning;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface TriageSettings {
  autoApproveThreshold: number;
  autoRejectThreshold: number;
}

const DEFAULT_SETTINGS: TriageSettings = {
  autoApproveThreshold: 0.85,
  autoRejectThreshold: 0.20,
};

const SETTINGS_KEY = "kb_triage_settings";

export async function getTriageSettings(): Promise<TriageSettings> {
  try {
    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, SETTINGS_KEY));
    if (row?.value) {
      return { ...DEFAULT_SETTINGS, ...(row.value as Partial<TriageSettings>) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
}

export async function saveTriageSettings(settings: Partial<TriageSettings>): Promise<TriageSettings> {
  const current = await getTriageSettings();
  const merged = { ...current, ...settings };
  await db
    .insert(systemSettingsTable)
    .values({
      key: SETTINGS_KEY,
      value: merged as unknown as Record<string, unknown>,
      category: "kb_triage",
      description: "AI auto-triage confidence thresholds for knowledge base staging",
    })
    .onConflictDoUpdate({
      target: systemSettingsTable.key,
      set: { value: merged as unknown as Record<string, unknown>, updatedAt: new Date() },
    });
  return merged;
}

// ── AI scoring prompt ─────────────────────────────────────────────────────────

const TRIAGE_PROMPT = `You are a strict quality-control reviewer for a knowledge base used by the BTS (Build Test Scale) affiliate marketing coaching assistant.

You will receive a training document extracted from a video transcript or coaching session. Your job is to evaluate it and return a structured triage decision.

SCORING CRITERIA:
- High quality (0.80-1.00): Clearly on-topic, actionable, well-structured, correct BTS branding, specific enough to be useful to a member asking the AI assistant. No private names, no filler, no off-brand references.
- Medium quality (0.40-0.79): On-topic but too vague, repetitive, missing key details, or needs minor editing. Should be reviewed by a human.
- Low quality (0.00-0.39): Off-topic, incoherent, mainly filler/small talk, duplicate of common knowledge with nothing specific, or contains significant brand/privacy violations.

BTS BRAND RULES:
- Must say "Build Test Scale" or "BTS" — never "TCE", "Cherrington", "Charrington"
- Coach surnames must not appear (Bobilev, Wissbaum, Rupp, Clark, Shepard)
- Adam's full name must not appear
- "support@buildtestscale.com" is the correct email

CATEGORIES: curriculum | strategy | sop | faq | platform_guide

Respond ONLY with valid JSON matching this exact schema (no markdown, no extra text):
{
  "confidenceScore": <number 0.00-1.00>,
  "recommendedAction": <"approve" | "reject" | "needs_review">,
  "suggestedCategory": <one of the 5 categories above>,
  "cleanedTitle": <improved, concise title for the doc (max 80 chars)>,
  "summary": <one-sentence summary of what this document teaches (max 150 chars)>,
  "reasoning": <1-2 sentence explanation of your confidence score>
}`;

export interface TriageResult {
  confidenceScore: number;
  recommendedAction: "approve" | "reject" | "needs_review";
  suggestedCategory: string;
  cleanedTitle: string;
  summary: string;
  reasoning: string;
}

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
          { role: "system", content: TRIAGE_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_completion_tokens: 400,
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
    const parsed = JSON.parse(raw) as TriageResult;
    return {
      confidenceScore: Math.max(0, Math.min(1, Number(parsed.confidenceScore) || 0)),
      recommendedAction: ["approve", "reject", "needs_review"].includes(parsed.recommendedAction)
        ? parsed.recommendedAction
        : "needs_review",
      suggestedCategory: parsed.suggestedCategory || "curriculum",
      cleanedTitle: (parsed.cleanedTitle || doc.title).substring(0, 80),
      summary: (parsed.summary || "").substring(0, 150),
      reasoning: parsed.reasoning || "",
    };
  } catch {
    throw new Error(`Failed to parse triage response: ${raw.substring(0, 200)}`);
  }
}

// ── Auto-triage a single doc ──────────────────────────────────────────────────

export interface AutoTriageDocResult {
  id: number;
  action: "auto_approved" | "auto_rejected" | "needs_review";
  confidenceScore: number;
  summary: string;
  cleanedTitle: string;
}

export async function runAutoTriageOnDoc(
  doc: typeof kbStagingDocsTable.$inferSelect,
  settings: TriageSettings,
): Promise<AutoTriageDocResult> {
  const result = await triageDoc(doc);

  let finalAction: "auto_approved" | "auto_rejected" | "needs_review";
  let newStatus: string;

  if (result.confidenceScore >= settings.autoApproveThreshold && result.recommendedAction === "approve") {
    finalAction = "auto_approved";
    newStatus = "approved";
  } else if (result.confidenceScore <= settings.autoRejectThreshold && result.recommendedAction === "reject") {
    finalAction = "auto_rejected";
    newStatus = "rejected";
  } else {
    finalAction = "needs_review";
    newStatus = "needs_review";
  }

  const updates: Partial<typeof kbStagingDocsTable.$inferSelect> = {
    aiConfidenceScore: result.confidenceScore,
    aiRecommendedAction: result.recommendedAction,
    aiSuggestedCategory: result.suggestedCategory,
    aiCleanedTitle: result.cleanedTitle,
    aiSummary: result.summary,
    status: newStatus as typeof doc.status,
  };

  if (finalAction === "auto_approved" || finalAction === "auto_rejected") {
    updates.autoAction = finalAction;
    updates.autoActionAt = new Date();
    updates.autoActionConfidence = result.confidenceScore;
  }

  await db
    .update(kbStagingDocsTable)
    .set(updates)
    .where(eq(kbStagingDocsTable.id, doc.id));

  // Persist to immutable audit log
  await db.insert(kbTriageAuditLogTable).values({
    stagingDocId: doc.id,
    eventType: finalAction,
    confidenceScore: result.confidenceScore,
    actorUserId: null,
    aiReasoning: result.reasoning,
    docTitle: doc.title,
  });

  if (finalAction === "auto_approved") {
    await pushDocToLive(doc, result);
  }

  return {
    id: doc.id,
    action: finalAction,
    confidenceScore: result.confidenceScore,
    summary: result.summary,
    cleanedTitle: result.cleanedTitle,
  };
}

async function pushDocToLive(
  doc: typeof kbStagingDocsTable.$inferSelect,
  result: TriageResult,
): Promise<void> {
  const content = scrubPrivateContent(doc.editedContent ?? doc.content);
  const title = scrubPrivateContent(result.cleanedTitle || doc.title);
  const category = result.suggestedCategory || doc.category;

  await db
    .insert(knowledgebaseDocsTable)
    .values({ title, category, content, audience: doc.audience ?? "member" })
    .onConflictDoUpdate({
      target: knowledgebaseDocsTable.title,
      set: {
        category: sql`EXCLUDED.category`,
        content: sql`EXCLUDED.content`,
        audience: sql`EXCLUDED.audience`,
        updatedAt: sql`NOW()`,
      },
    });

  await db
    .update(kbStagingDocsTable)
    .set({ status: "pushed" })
    .where(eq(kbStagingDocsTable.id, doc.id));
}

// ── Undo an auto-action ────────────────────────────────────────────────────────
//
// IMPORTANT: we do NOT null out autoAction/autoActionAt/autoActionConfidence.
// Those fields are the original audit record on the staging row. Instead, we
// append an 'undone' row to kbTriageAuditLogTable so the full history is
// preserved and both the action and its reversal are queryable.

export async function undoAutoAction(
  doc: typeof kbStagingDocsTable.$inferSelect,
  adminUserId: number,
): Promise<void> {
  if (!doc.autoAction) {
    throw new Error("Document has no auto-action to undo");
  }

  // Move doc back to human review queue
  await db
    .update(kbStagingDocsTable)
    .set({
      status: "needs_review",
      reviewedBy: adminUserId,
      reviewedAt: new Date(),
    })
    .where(eq(kbStagingDocsTable.id, doc.id));

  // Append immutable undo event (preserves original autoAction* columns)
  await db.insert(kbTriageAuditLogTable).values({
    stagingDocId: doc.id,
    eventType: "undone",
    confidenceScore: doc.autoActionConfidence,
    actorUserId: adminUserId,
    aiReasoning: `Undone by admin (original action: ${doc.autoAction})`,
    docTitle: doc.title,
  });

  // If the doc was auto-approved and pushed live, remove it from the live KB
  if (doc.autoAction === "auto_approved") {
    const cleanedTitle = scrubPrivateContent(doc.aiCleanedTitle ?? doc.title);
    await db
      .delete(knowledgebaseDocsTable)
      .where(eq(knowledgebaseDocsTable.title, cleanedTitle));
  }
}

// ── Background batch triage (manages the shared run-state flag) ───────────────

export async function runTriageBackground(
  docs: (typeof kbStagingDocsTable.$inferSelect)[],
): Promise<{ autoApproved: number; autoRejected: number; needsReview: number; errors: number }> {
  if (_triageRunning) {
    console.log("[KB Triage] Already running — skipping duplicate invocation");
    return { autoApproved: 0, autoRejected: 0, needsReview: 0, errors: 0 };
  }

  _triageRunning = true;
  const settings = await getTriageSettings();
  let autoApproved = 0, autoRejected = 0, needsReview = 0, errors = 0;

  console.log(`[KB Triage] Starting triage on ${docs.length} documents`);

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    try {
      const result = await runAutoTriageOnDoc(doc, settings);
      if (result.action === "auto_approved") autoApproved++;
      else if (result.action === "auto_rejected") autoRejected++;
      else needsReview++;
      console.log(`[KB Triage] ${i + 1}/${docs.length}: ${result.action} (${(result.confidenceScore * 100).toFixed(0)}%) — ${result.cleanedTitle}`);
    } catch (err) {
      errors++;
      console.error(`[KB Triage] Error on doc ${doc.id} "${doc.title}":`, err instanceof Error ? err.message : err);
    }
    if (i < docs.length - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  _triageRunning = false;
  console.log(`[KB Triage] Done. auto_approved=${autoApproved}, auto_rejected=${autoRejected}, needs_review=${needsReview}, errors=${errors}`);
  return { autoApproved, autoRejected, needsReview, errors };
}
