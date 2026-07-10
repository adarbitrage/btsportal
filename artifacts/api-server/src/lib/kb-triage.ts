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
  gatherFlagContext,
  maxSeverity,
  STALE_LEGACY_PATTERNS,
  type RiskFlag,
} from "./kb-flags.js";
import { runRetrievalSelfTest, type RetrievalSelfTest } from "./kb-retrieval-selftest.js";
import { recordProposedSynonym } from "./kb-proposed-synonyms.js";
import {
  HOME_ROOTS,
  ALL_NODES,
  CITABLE_DOC_CLASSES,
  isCitableDocClass,
  CEILINGS,
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

// Citeable-only review pipeline (Task #1873): every doc in AI Document Review
// exists to be approved and promoted into the live, citeable KB. The
// non-citeable `transcript` class belongs to the separate AI Source Knowledge
// corpus and is NEVER a valid suggestion here — so triage may only ever propose
// a citeable class (curated / overview / navigation).
const REVIEW_DOC_CLASSES = CITABLE_DOC_CLASSES.join(" | ");
// Fallback when the model proposes a non-citeable / invalid class: the general
// citeable answer class. A review doc's suggested class is never non-citeable.
const DEFAULT_REVIEW_DOC_CLASS = "curated";

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
- doc class (pick ONE): ${REVIEW_DOC_CLASSES} — every review doc is CITEABLE; never suggest a training-only class
- ceiling (how far the assistant may go with this doc — pick ONE): ${CEILINGS.join(" | ")} — "operational" = concrete how-to steps a member executes; "conceptual" = principles/strategy/why; "troubleshooting" = diagnosing and fixing a specific problem.
- tags (pick 0-4 from): ${tagList}

TIPS-AND-TRICKS RULE (short, tool-driven "tips and tricks" walkthroughs — e.g. Nano Banana, Grok Imagine, Anstrex ad copy, headline formulas — that show a member how to get one specific thing done, usually with a named piece of software):
- Even a tip in review is a CITEABLE answer doc — suggest doc class "curated" (or "overview" if it is more of an orientation/map). NEVER a training-only class.
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

STAKES CONTEXT for doc class + tags: every review doc is CITABLE (quoted to
members as BTS truth) once approved — the doc class only chooses WHICH citeable
shape fits: "curated" = a direct answer doc (FAQ, glossary, tool guide),
"overview" = an orientation / map doc, "navigation" = a click-path walkthrough.
If the content touches money, refunds, guarantees, legal, compliance or anything
a member could act on to their detriment, note it in "reasoning". Tags drive
retrieval boosts: a wrong tool tag actively ROUTES the wrong members here, so
only tag tools the doc genuinely teaches.

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
  "suggestedDocClass": <${REVIEW_DOC_CLASSES}>,
  "suggestedCeiling": <${CEILINGS.join(" | ")}>,
  "suggestedCeilingReason": <one short sentence, max 140 chars, saying WHY this ceiling fits (what the assistant may do with this doc and where it must hand off)>,
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
  suggestedCeiling: string | null;
  /** One-line rationale for the suggested ceiling (advisory only). */
  suggestedCeilingReason: string;
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
const CEILING_SET = new Set<string>(CEILINGS as readonly string[]);

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
    // Citeable-only review pipeline (Task #1873): a review doc's suggested class
    // must always be citeable. A non-citeable (e.g. `transcript`) or invalid
    // value resolves to the general citeable answer class instead of being
    // stored as-is or left null — the AI can never propose non-citeable here.
    const docClass = isCitableDocClass(parsed.suggestedDocClass)
      ? (parsed.suggestedDocClass as string)
      : DEFAULT_REVIEW_DOC_CLASS;
    const ceiling = typeof parsed.suggestedCeiling === "string" && CEILING_SET.has(parsed.suggestedCeiling)
      ? parsed.suggestedCeiling
      : null;
    const ceilingReason = typeof parsed.suggestedCeilingReason === "string"
      ? parsed.suggestedCeilingReason.trim().substring(0, 140)
      : "";
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
      suggestedCeiling: ceiling,
      suggestedCeilingReason: ceilingReason,
      suggestedTags: tags,
      memberQuestions,
      suggestedAliases,
    };
  } catch {
    throw new Error(`Failed to parse triage response: ${raw.substring(0, 200)}`);
  }
}

// ── Evidence-based title suggestions (Task #1848) ────────────────────────────
//
// A proposed title is only surfaced to the reviewer when it MEASURABLY beats
// the current title through the retrieval self-test (same member questions,
// real retrieval path) or fixes a brand/canonical-naming violation. Otherwise
// the suggestion is suppressed and the stored title stands untouched.

/** Does a title violate the brand/canonical-naming rules (legacy brand names,
 * retired coach surnames, dropped networks, legacy email domains)? */
export function titleViolatesBrandRules(title: string): boolean {
  return STALE_LEGACY_PATTERNS.some(({ re }) => re.test(title));
}

/**
 * Pure comparison of two self-test outcomes for the SAME question list.
 * - improved: more questions pass, or a question that failed to surface under
 *   the current title newly surfaces under the suggested one.
 * - strictlyBetter: improved AND no regression on any question (pass stays a
 *   pass, surfacing stays surfaced).
 */
export function compareTitleOutcomes(
  current: RetrievalSelfTest,
  suggested: RetrievalSelfTest,
): { improved: boolean; strictlyBetter: boolean } {
  const curByQ = new Map(current.results.map((r) => [r.question, r]));
  let improved = suggested.passedCount > current.passedCount;
  let regressed = false;
  for (const s of suggested.results) {
    const c = curByQ.get(s.question);
    if (!c) continue;
    if ((!c.passed && s.passed) || (!c.wouldSurface && s.wouldSurface)) improved = true;
    if ((c.passed && !s.passed) || (c.wouldSurface && !s.wouldSurface)) regressed = true;
  }
  return { improved, strictlyBetter: improved && !regressed };
}

function summarizeOutcome(title: string, test: RetrievalSelfTest) {
  return {
    title,
    passedCount: test.passedCount,
    total: test.results.length,
    passedQuestions: test.results.filter((r) => r.passed).map((r) => r.question),
  };
}

/**
 * The tags a doc's retrieval self-test must score against — the tags it would
 * actually PUBLISH with (Task #1868). Once a doc has a filed placement its
 * controlled `taxonomyTags` are authoritative (they're what publish copies into
 * the live doc and what live retrieval's tag-tier boost reads); the AI's
 * per-run suggested tags are only a fallback for a doc that has never been
 * filed. Never reads the vestigial free-text `tags` column. Mirrors the
 * filed-first doc-class resolution so the analysis path and the post-save
 * re-score path always score against the SAME tag source.
 */
export function resolveSelfTestTags(
  doc: {
    homeRoot: string | null;
    node: string | null;
    docClassTarget: string | null;
    taxonomyTags: string[] | null;
  },
  aiSuggestedTags: string[] | null | undefined,
): string[] {
  const filed = doc.homeRoot != null || doc.node != null || doc.docClassTarget != null;
  return filed ? (doc.taxonomyTags ?? []) : (aiSuggestedTags ?? []);
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

  // Filed placement is authoritative (Task #1847). Analysis suggestions are
  // ADVISORY ONLY: every judging path (retrieval self-test, risk flags) must
  // evaluate the doc as it is FILED and would publish. The AI's per-run
  // suggestion is only a fallback for fields the doc has never been filed
  // with. One coherent placement — never a filed/suggested hybrid.
  const effectiveDocClass = doc.docClassTarget ?? result.suggestedDocClass ?? null;
  const effectiveHomeRoot = doc.homeRoot ?? result.suggestedHomeRoot ?? null;
  const effectiveNode = doc.node ?? result.suggestedNode ?? null;

  // Citeable-only review pipeline (Task #1873): review docs exist to be
  // published + cited, so the class the SELF-TEST scores against is always
  // citeable — result.suggestedDocClass is now constrained to a citeable class,
  // so an UNFILED doc resolves to one. Guard the legacy edge where a doc is
  // still FILED under a non-citeable class: score it citeable so the result
  // reflects title/content (not a spurious non-citeable fallback), and surface
  // a warning prompting the reviewer to re-file it.
  const filedNonCitable =
    doc.docClassTarget != null && !isCitableDocClass(doc.docClassTarget);
  const selfTestDocClass = isCitableDocClass(effectiveDocClass)
    ? (effectiveDocClass as string)
    : DEFAULT_REVIEW_DOC_CLASS;

  // Taxonomy-suggestion lock (mirrors the title lock): once a doc HAS a filed
  // placement (set by the synthesis pipeline or a reviewer), re-analysis must
  // not churn out a fresh suggestion that second-guesses the intentional
  // filing — the stored suggestion (if any) stays as-is, purely advisory.
  const taxonomyLocked =
    doc.homeRoot != null || doc.node != null || doc.docClassTarget != null;

  // Synonym-gap proposals (Task #1804): uncovered member phrasings go to the
  // human-approval queue (mirrors observedTools). Fire-and-forget.
  for (const alias of result.suggestedAliases) {
    void recordProposedSynonym(alias.memberPhrase, alias.canonicalTerm, doc.title);
  }

  const effectiveContent = doc.editedContent ?? doc.content;

  // Retrieval self-test (Task #1804) + always-on title comparison (Task #1865).
  // Each member question runs through the REAL retrieval path vs live docs,
  // with the draft scored ad-hoc (embeddings computed per run and discarded —
  // never stored for staging docs). A self-test failure must never fail
  // analysis.
  //
  // When the LLM proposes a different title, BOTH titles are scored through the
  // same questions and the before/after comparison is ALWAYS attached — the
  // suggestion is surfaced regardless of any prior title decision and is never
  // auto-applied. The STORED title stands and everything downstream (flags,
  // self-test verdict) judges it; acceptance is accept-on-click only.
  const draftBase = {
    content: effectiveContent,
    // The class/tags the draft would publish with — they drive the
    // curated-tier and tag-tier rules inside the shared ranking. FILED
    // class/tags first — suggestions never demote a filed doc (Task #1847,
    // #1868). Scoring against the actual published tags (not a per-run AI
    // guess) keeps the current/suggested title scores stable across runs and
    // consistent with the post-save re-score.
    //
    // Citeable-only (Task #1873): review docs always score as citeable —
    // selfTestDocClass coerces the legacy non-citeable edge to a citeable class
    // so the verdict reflects title/content, never a non-citeable fallback.
    docClass: selfTestDocClass,
    tags: resolveSelfTestTags(doc, result.suggestedTags),
  };
  const runTest = async (title: string): Promise<RetrievalSelfTest | null> => {
    try {
      return await runRetrievalSelfTest({ title, ...draftBase }, result.memberQuestions);
    } catch (err) {
      console.error(`[KB Triage] retrieval self-test failed for doc ${doc.id}:`, err);
      return null;
    }
  };

  const proposedTitle = (result.cleanedTitle || "").trim();
  const hasProposal = !!proposedTitle && proposedTitle !== doc.title.trim();

  let selfTest: RetrievalSelfTest | null = null;
  let surfacedSuggestion: string | null = null; // what gets persisted to aiCleanedTitle

  if (!hasProposal) {
    // No (new) suggestion — single self-test against the stored title.
    if (result.memberQuestions.length > 0) selfTest = await runTest(doc.title);
  } else {
    // Always surface the fresh suggestion and always attach the before/after
    // comparison (Task #1865). The stored title stands; the verdict (selfTest,
    // flags) is judged against it — the reviewer applies the suggestion on
    // click, nothing is auto-replaced.
    surfacedSuggestion = proposedTitle;
    const currentTest = result.memberQuestions.length > 0 ? await runTest(doc.title) : null;
    const suggestedTest = result.memberQuestions.length > 0 ? await runTest(proposedTitle) : null;

    selfTest = currentTest;
    if (currentTest && suggestedTest) {
      const brandFix =
        titleViolatesBrandRules(doc.title) && !titleViolatesBrandRules(proposedTitle);
      const { improved, strictlyBetter } = compareTitleOutcomes(currentTest, suggestedTest);
      selfTest = {
        ...currentTest,
        titleComparison: {
          current: summarizeOutcome(doc.title, currentTest),
          suggested: summarizeOutcome(proposedTitle, suggestedTest),
          improved,
          strictlyBetter,
          brandFix,
        },
      };
    }
  }
  // The stored title always stands — analysis never replaces it (Task #1865).
  const finalTitle = doc.title;

  // Duplicate / conflict checks judge the title that would publish — the STORED
  // title, never the un-accepted suggestion.
  const ctx = await gatherFlagContext({
    title: doc.title,
    aiCleanedTitle: null,
  });
  const flags = computeRiskFlags({
    title: finalTitle,
    content: effectiveContent,
    authorityRole: doc.authorityRole,
    // ONE coherent placement, filed-first (Task #1847): flags are judged
    // against the doc as filed, never a filed/suggested hybrid.
    docClassTarget: effectiveDocClass,
    homeRoot: effectiveHomeRoot,
    node: effectiveNode,
    corroborationCount: doc.corroborationCount ?? 0,
    duplicateTitle: ctx.duplicateTitle,
    conflictsWithVerified: ctx.conflictsWithVerified,
  });

  // Citeable-only review pipeline (Task #1873): a legacy review doc still filed
  // under a non-citeable class would never surface to members. Surface a
  // warning prompting the reviewer to re-file it as a citeable class.
  if (filedNonCitable) {
    flags.push({
      type: "non_citable_review_doc",
      severity: "high",
      message: "Filed under a non-citeable class — review docs must be citeable",
      detail: `This review doc is filed as "${doc.docClassTarget}", which is never surfaced to members. Re-file it as a citeable class (curated / overview / navigation) so it can be published and cited.`,
    });
  }

  // Non-critical retrieval-gap flag when the doc fails its own questions.
  const selfTestFlag = computeRetrievalSelfTestFlag(selfTest);
  if (selfTestFlag) flags.push(selfTestFlag);

  const conflictFlag = flags.find((f) => f.type === "conflict");
  const needsExpert = maxSeverity(flags) === "critical";

  const aiSuggestedTaxonomy = {
    homeRoot: result.suggestedHomeRoot,
    node: result.suggestedNode,
    docClass: result.suggestedDocClass,
    ceiling: result.suggestedCeiling,
    tags: result.suggestedTags,
    category: result.suggestedCategory,
  };

  // Ceiling advisory (Task #1868): unlike the rest of the taxonomy suggestion
  // (frozen once the doc is filed), the depth ceiling is re-evaluated on EVERY
  // run — even for filed docs — because re-checking it is cheap and never
  // cascades into retrieval / related-topics filing. Surfaced ONLY when the AI's
  // fresh proposal differs from (or is missing on) the doc's current ceiling;
  // cleared to null when they agree. Never auto-applied, and refreshing it here
  // does NOT reopen the home-root / node / doc-class lock (dedicated columns,
  // written outside the taxonomyLocked gate).
  const currentCeiling = doc.ceiling ?? null;
  const proposedCeiling = result.suggestedCeiling; // validated ∈ CEILINGS or null
  const surfaceCeiling = !!proposedCeiling && proposedCeiling !== currentCeiling;
  const ceilingAdvisory = {
    aiSuggestedCeiling: surfaceCeiling ? proposedCeiling : null,
    aiSuggestedCeilingReason: surfaceCeiling ? (result.suggestedCeilingReason || null) : null,
  };

  await db
    .update(kbStagingDocsTable)
    .set({
      aiRecommendedAction: "needs_review",
      // Never regenerate taxonomy suggestions for a doc with a filed placement
      // (Task #1847) — the stored suggestion stays stable and advisory.
      ...(taxonomyLocked ? {} : { aiSuggestedCategory: result.suggestedCategory }),
      // Analysis ALWAYS re-proposes a fresh title and clears any prior
      // accept/dismiss/edit decision (Task #1865), so the new suggestion is
      // actionable on click. The stored title itself is never touched here.
      aiCleanedTitle: surfacedSuggestion,
      aiTitleDecision: null,
      aiSummary: result.summary,
      ...(taxonomyLocked ? {} : { aiSuggestedTaxonomy }),
      // Always refreshed — even for filed docs (see ceilingAdvisory above).
      ...ceilingAdvisory,
      riskFlags: flags,
      retrievalSelfTest: selfTest,
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
  // Citeable-only (Task #1873): score the re-test against the class this review
  // doc would actually PUBLISH with, coerced to a citeable class exactly like
  // the analysis path (runAutoTriageOnDoc). Without this, a legacy doc still
  // carrying a non-citeable target/suggestion (e.g. transcript) re-scores as
  // non-citeable and never surfaces in retrieval — the 0/5 bug this task fixes.
  const rawSelfTestDocClass = doc.docClassTarget ?? suggested?.docClass ?? null;
  const selfTestDocClass = isCitableDocClass(rawSelfTestDocClass)
    ? rawSelfTestDocClass
    : DEFAULT_REVIEW_DOC_CLASS;
  let selfTest: RetrievalSelfTest;
  try {
    selfTest = await runRetrievalSelfTest(
      {
        title,
        content: doc.editedContent ?? doc.content,
        docClass: selfTestDocClass,
        // Score against the tags the doc would actually PUBLISH with — filed
        // taxonomyTags first, AI suggestion only for never-filed docs (Task
        // #1868). Must match the analysis path or scores drift between runs.
        tags: resolveSelfTestTags(doc, suggested?.tags),
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
