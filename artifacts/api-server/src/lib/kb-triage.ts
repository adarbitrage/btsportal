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
  computeRetrievalSelfTestFlag,
  autoFixRelatedTopics,
  gatherFlagContext,
  maxSeverity,
  type RiskFlag,
} from "./kb-flags.js";
import { runRetrievalSelfTest, type RetrievalSelfTest } from "./kb-retrieval-selftest.js";
import { recordProposedSynonym } from "./kb-proposed-synonyms.js";
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
import { callLLMWithRetry } from "./kb-synthesis.js";

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

TITLE RULES (the title is a RETRIEVAL SURFACE — the assistant finds docs by
matching member questions against title + content, so a title written in
member vocabulary is found; a clever or internal title is invisible):
- Lead with the canonical curriculum vocabulary and exact tool names members
  use ("Flexy", "Blitz", "7 Pillars", the affiliate network's real name) — the
  words a member would literally type when asking about this topic.
- Say what the doc ANSWERS, not what session it came from ("How to Set Up
  Flexy Campaign Tracking", never "Coaching Call 14 Notes" or "Q&A Replay").
- No dates, coach names, filler ("Complete Guide", "Everything About"), or
  internal jargon a member wouldn't search for.

STAKES CONTEXT for doc class + tags: doc class decides how the assistant may
USE the doc — "curated"/"overview" content is CITABLE (quoted to members as
BTS truth), while "transcript" is training-only background. If the content
touches money, refunds, guarantees, legal, compliance or anything a member
could act on to their detriment, prefer the conservative class and say why in
"reasoning". Tags drive retrieval boosts: a wrong tool tag actively ROUTES the
wrong members here, so only tag tools the doc genuinely teaches.

MEMBER QUESTIONS: write 3-5 questions a REAL member would ask that this doc
should answer — casual member phrasing (how members actually talk in chat),
not textbook rewordings of the title. These power a retrieval self-test.

SYNONYM GAPS: if members would use a casual phrase/nickname for this doc's
topic that the doc itself never says (e.g. "money back" for refund policy),
report it in "suggestedAliases" with the canonical term the doc DOES use.
Only genuinely different vocabulary — not trivial rephrasings. [] if none.

Respond ONLY with valid JSON (no markdown, no extra text):
{
  "cleanedTitle": <improved concise title following TITLE RULES, max 80 chars>,
  "summary": <one-sentence summary of what it teaches, max 150 chars>,
  "suggestedCategory": <one of the 5 categories>,
  "suggestedHomeRoot": <${ROOT_LIST}>,
  "suggestedNode": <a node slug from the list>,
  "suggestedDocClass": <${DOC_CLASSES.join(" | ")}>,
  "suggestedTags": <array of 0-4 tag slugs>,
  "observedTools": <array of names of any third-party or in-house SOFTWARE / TOOL / PLATFORM the document tells the member to use that is NOT already in the tag list above; plain names, [] if none>,
  "memberQuestions": <array of 3-5 member-phrased questions this doc should answer>,
  "suggestedAliases": <array of {"memberPhrase": <casual member wording>, "canonicalTerm": <the doc's own word(s) for it>}, [] if none>,
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
  /** 3-5 member-phrased questions the doc should answer (retrieval self-test). */
  memberQuestions: string[];
  /** Uncovered member phrasings → canonical terms (synonym-gap proposals). */
  suggestedAliases: Array<{ memberPhrase: string; canonicalTerm: string }>;
}

// JSON output + reasoning headroom (see gpt-5 starvation note in triageDoc).
// Bumped from 4000 when memberQuestions/suggestedAliases were added (#1804).
const TRIAGE_MAX_TOKENS = 6000;

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

  // gpt-5 is a reasoning model: its invisible reasoning tokens count against
  // max_completion_tokens, so the old 500-token budget starved on every call
  // (200 OK, empty content, finish_reason=length). Give thousands of tokens of
  // headroom and route through the shared retry/budget-escalation helper.
  const raw = await callLLMWithRetry(
    "triage",
    buildTriagePrompt(effectiveTags.join(", ")),
    userMessage,
    TRIAGE_MAX_TOKENS,
    true,
  );

  try {
    const parsed = JSON.parse(raw) as Partial<TriageResult> & {
      suggestedTags?: unknown;
      observedTools?: unknown;
      memberQuestions?: unknown;
      suggestedAliases?: unknown;
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
    const memberQuestions = Array.isArray(parsed.memberQuestions)
      ? parsed.memberQuestions.map(String).map((q) => q.trim()).filter(Boolean).slice(0, 5)
      : [];
    const suggestedAliases = Array.isArray(parsed.suggestedAliases)
      ? (parsed.suggestedAliases as unknown[])
          .filter((a): a is { memberPhrase: unknown; canonicalTerm: unknown } =>
            typeof a === "object" && a !== null)
          .map((a) => ({
            memberPhrase: String(a.memberPhrase ?? "").trim(),
            canonicalTerm: String(a.canonicalTerm ?? "").trim(),
          }))
          .filter((a) => a.memberPhrase && a.canonicalTerm)
          .slice(0, 5)
      : [];
    return {
      suggestedCategory: parsed.suggestedCategory || "curriculum",
      cleanedTitle: (parsed.cleanedTitle || doc.title).substring(0, 80),
      summary: (parsed.summary || "").substring(0, 150),
      reasoning: parsed.reasoning || "",
      suggestedHomeRoot: root,
      suggestedNode: node,
      suggestedDocClass: docClass,
      suggestedTags: tags,
      memberQuestions,
      suggestedAliases,
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

  // Title-suggestion lock (Task #1839): once the reviewer accepted, dismissed
  // or hand-edited the title, re-analysis must NOT churn out a new suggestion
  // — the stored title stands, and everything downstream (flags, self-test,
  // duplicate check) is computed against it.
  const titleLocked = doc.aiTitleDecision != null;
  const effectiveTitle = titleLocked ? doc.title : (result.cleanedTitle || doc.title);

  // Synonym-gap proposals (Task #1804): uncovered member phrasings go to the
  // human-approval queue (mirrors observedTools). Fire-and-forget.
  for (const alias of result.suggestedAliases) {
    void recordProposedSynonym(alias.memberPhrase, alias.canonicalTerm, doc.title);
  }

  // Related-topics auto-fix (Task #1839): deterministically clean the
  // "## Related topics" section against the doc's placement BEFORE flags and
  // the self-test run, so the mismatch flag only survives when something
  // genuinely can't be auto-resolved (e.g. no placement).
  // Judged against the doc's FILED placement only — never the AI's suggested
  // taxonomy. An unfiled doc has no placement to judge against, so it is never
  // rewritten (the mismatch flag stays a human signal there).
  const baseContent = doc.editedContent ?? doc.content;
  const relFix = autoFixRelatedTopics({
    content: baseContent,
    homeRoot: doc.homeRoot,
    node: doc.node,
  });
  const effectiveContent = relFix.content;

  // Retrieval self-test (Task #1804): run each member question through the
  // REAL retrieval path vs live docs + score the draft ad-hoc (embeddings are
  // computed per run and discarded — never stored for staging docs). A
  // self-test failure must never fail analysis. Runs against whichever title
  // actually stands (the suggestion when pending, the stored title when the
  // suggestion was decided/edited) so the test matches what publish would use.
  let selfTest: RetrievalSelfTest | null = null;
  if (result.memberQuestions.length > 0) {
    try {
      selfTest = await runRetrievalSelfTest(
        {
          title: effectiveTitle,
          content: effectiveContent,
          // The class/tags the draft would publish with — they drive the
          // curated-tier and tag-tier rules inside the shared ranking.
          docClass: result.suggestedDocClass ?? doc.docClassTarget ?? null,
          tags: result.suggestedTags ?? [],
        },
        result.memberQuestions,
      );
    } catch (err) {
      console.error(`[KB Triage] retrieval self-test failed for doc ${doc.id}:`, err);
    }
  }

  const ctx = await gatherFlagContext({
    title: doc.title,
    aiCleanedTitle: titleLocked ? null : result.cleanedTitle,
  });
  const flags = computeRiskFlags({
    title: effectiveTitle,
    content: effectiveContent,
    authorityRole: doc.authorityRole,
    docClassTarget: result.suggestedDocClass ?? doc.docClassTarget,
    homeRoot: result.suggestedHomeRoot ?? doc.homeRoot,
    // Prefer the doc's ACTUAL filed node (reviewers may have re-filed it);
    // fall back to the AI suggestion for never-filed drafts.
    node: doc.node ?? result.suggestedNode,
    corroborationCount: doc.corroborationCount ?? 0,
    duplicateTitle: ctx.duplicateTitle,
    conflictsWithVerified: ctx.conflictsWithVerified,
  });

  // Non-critical retrieval-gap flag when the doc fails its own questions.
  const selfTestFlag = computeRetrievalSelfTestFlag(selfTest);
  if (selfTestFlag) flags.push(selfTestFlag);

  const conflictFlag = flags.find((f) => f.type === "conflict");
  const needsExpert = maxSeverity(flags) === "critical";

  const aiSuggestedTaxonomy = {
    homeRoot: result.suggestedHomeRoot,
    node: result.suggestedNode,
    docClass: result.suggestedDocClass,
    tags: result.suggestedTags,
    category: result.suggestedCategory,
  };

  // Persist the related-topics auto-fix where the reviewed content actually
  // lives: editedContent when the doc already has one, otherwise content.
  const contentUpdates: Partial<typeof kbStagingDocsTable.$inferInsert> = {};
  if (relFix.changed) {
    if (doc.editedContent != null) contentUpdates.editedContent = relFix.content;
    else contentUpdates.content = relFix.content;
  }

  await db
    .update(kbStagingDocsTable)
    .set({
      aiRecommendedAction: "needs_review",
      aiSuggestedCategory: result.suggestedCategory,
      // Never regenerate a decided/edited suggestion (Task #1839).
      ...(titleLocked ? {} : { aiCleanedTitle: result.cleanedTitle }),
      aiSummary: result.summary,
      aiSuggestedTaxonomy,
      riskFlags: flags,
      retrievalSelfTest: selfTest,
      needsExpert,
      conflictData: conflictFlag ? { message: conflictFlag.message, detail: conflictFlag.detail } : null,
      status: "needs_review" as typeof doc.status,
      ...contentUpdates,
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

// ── Retrieval self-test re-score (Task #1839) ────────────────────────────────
//
// Re-runs the STORED 5-question self-test (retrieval only — no LLM call) after
// the title standing for the doc changes (suggestion dismissed / human title
// edit), so the pass/fail verdict and the retrieval_gap flag stay honest
// against the title that will actually publish. Pure aside from the DB write.

/** Replace (or clear) the retrieval_gap flag in a flag list for a new self-test. */
export function replaceRetrievalGapFlag(
  flags: RiskFlag[],
  selfTest: RetrievalSelfTest | null,
): RiskFlag[] {
  const rest = (flags ?? []).filter((f) => f.type !== "retrieval_gap");
  const gap = computeRetrievalSelfTestFlag(selfTest);
  return gap ? [...rest, gap] : rest;
}

export async function rescoreSelfTestForTitle(
  doc: typeof kbStagingDocsTable.$inferSelect,
  title: string,
): Promise<void> {
  const stored = doc.retrievalSelfTest as RetrievalSelfTest | null;
  const questions = stored?.memberQuestions ?? [];
  if (!questions.length) return; // never self-tested — nothing to re-score

  const suggested = doc.aiSuggestedTaxonomy as { docClass?: string | null; tags?: string[] } | null;
  let selfTest: RetrievalSelfTest;
  try {
    selfTest = await runRetrievalSelfTest(
      {
        title,
        content: doc.editedContent ?? doc.content,
        docClass: doc.docClassTarget ?? suggested?.docClass ?? null,
        tags: suggested?.tags ?? [],
      },
      questions,
    );
  } catch (err) {
    console.error(`[KB Triage] self-test re-score failed for doc ${doc.id}:`, err);
    return; // keep the old verdict rather than clobbering it
  }

  const flags = replaceRetrievalGapFlag((doc.riskFlags ?? []) as RiskFlag[], selfTest);
  await db
    .update(kbStagingDocsTable)
    .set({ retrievalSelfTest: selfTest, riskFlags: flags })
    .where(eq(kbStagingDocsTable.id, doc.id));
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
