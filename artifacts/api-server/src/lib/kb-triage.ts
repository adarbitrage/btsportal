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
  STALE_LEGACY_PATTERNS,
  type RiskFlag,
} from "./kb-flags.js";
import { systemSettingsTable } from "@workspace/db/schema";
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

/** Canonical vocabulary that must survive a title rewrite for auto-accept. */
export const CANONICAL_TITLE_TERMS: readonly string[] = ["flexy", "blitz", "7 pillars", "bts"];

/** True when every canonical term present in `current` also appears in `suggested`. */
export function preservesCanonicalNames(current: string, suggested: string): boolean {
  const cur = current.toLowerCase();
  const sug = suggested.toLowerCase();
  return CANONICAL_TITLE_TERMS.every((t) => !cur.includes(t) || sug.includes(t));
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

/** Off-by-default admin setting: auto-accept strictly-better title suggestions. */
export const TITLE_AUTO_ACCEPT_SETTING_KEY = "kb_title_auto_accept";

export async function isTitleAutoAcceptEnabled(): Promise<boolean> {
  try {
    const rows = await db
      .select({ value: systemSettingsTable.value })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, TITLE_AUTO_ACCEPT_SETTING_KEY));
    const value = rows[0]?.value as { enabled?: unknown } | boolean | undefined;
    if (typeof value === "boolean") return value;
    return value?.enabled === true;
  } catch {
    return false; // fail closed — auto-accept stays off
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

  // Filed placement is authoritative (Task #1847). Analysis suggestions are
  // ADVISORY ONLY: every judging path (retrieval self-test, risk flags) must
  // evaluate the doc as it is FILED and would publish. The AI's per-run
  // suggestion is only a fallback for fields the doc has never been filed
  // with. One coherent placement — never a filed/suggested hybrid.
  const effectiveDocClass = doc.docClassTarget ?? result.suggestedDocClass ?? null;
  const effectiveHomeRoot = doc.homeRoot ?? result.suggestedHomeRoot ?? null;
  const effectiveNode = doc.node ?? result.suggestedNode ?? null;

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

  // Retrieval self-test (Task #1804) + evidence-based title gate (Task #1848).
  // Each member question runs through the REAL retrieval path vs live docs,
  // with the draft scored ad-hoc (embeddings computed per run and discarded —
  // never stored for staging docs). A self-test failure must never fail
  // analysis.
  //
  // When the LLM proposes a different title (and the suggestion isn't locked),
  // BOTH titles are scored through the same questions. The suggestion is only
  // surfaced when it measurably improves retrieval or fixes a brand/canonical
  // naming violation; otherwise it is suppressed and the stored title stands.
  const draftBase = {
    content: effectiveContent,
    // The class/tags the draft would publish with — they drive the
    // curated-tier and tag-tier rules inside the shared ranking. FILED
    // class first — suggestions never demote a filed doc (Task #1847).
    docClass: effectiveDocClass,
    tags: result.suggestedTags ?? [],
  };
  const runTest = async (title: string): Promise<RetrievalSelfTest | null> => {
    try {
      return await runRetrievalSelfTest({ title, ...draftBase }, result.memberQuestions);
    } catch (err) {
      console.error(`[KB Triage] retrieval self-test failed for doc ${doc.id}:`, err);
      return null;
    }
  };

  const proposedTitle = titleLocked ? null : (result.cleanedTitle || "").trim();
  const hasProposal = !!proposedTitle && proposedTitle !== doc.title.trim();

  let selfTest: RetrievalSelfTest | null = null;
  let surfacedSuggestion: string | null = null; // what gets persisted to aiCleanedTitle
  let autoAccept = false;
  let standingTitle = doc.title;

  if (!hasProposal) {
    // No (new) suggestion — single self-test against the standing title.
    standingTitle = doc.title;
    if (result.memberQuestions.length > 0) selfTest = await runTest(standingTitle);
  } else {
    const currentTest = result.memberQuestions.length > 0 ? await runTest(doc.title) : null;
    const suggestedTest = result.memberQuestions.length > 0 ? await runTest(proposedTitle!) : null;

    const brandFix =
      titleViolatesBrandRules(doc.title) && !titleViolatesBrandRules(proposedTitle!);
    const { improved, strictlyBetter } =
      currentTest && suggestedTest
        ? compareTitleOutcomes(currentTest, suggestedTest)
        : { improved: false, strictlyBetter: false };

    const surface = improved || brandFix;
    if (!surface) {
      // Evidence gate: no measurable win, no brand fix — no suggestion. The
      // stored title stands and everything downstream judges it.
      standingTitle = doc.title;
      selfTest = currentTest;
      if (currentTest && suggestedTest) {
        selfTest = {
          ...currentTest,
          titleComparison: {
            current: summarizeOutcome(doc.title, currentTest),
            suggested: summarizeOutcome(proposedTitle!, suggestedTest),
            improved,
            strictlyBetter,
            brandFix,
            autoAccepted: false,
          },
        };
      }
    } else {
      surfacedSuggestion = proposedTitle;
      standingTitle = proposedTitle!;
      selfTest = suggestedTest;

      // Off-by-default auto-accept: strictly better on every question AND
      // canonical tool names preserved AND no brand violation introduced.
      autoAccept =
        strictlyBetter &&
        !titleViolatesBrandRules(proposedTitle!) &&
        preservesCanonicalNames(doc.title, proposedTitle!) &&
        (await isTitleAutoAcceptEnabled());

      if (currentTest && suggestedTest) {
        selfTest = {
          ...suggestedTest,
          titleComparison: {
            current: summarizeOutcome(doc.title, currentTest),
            suggested: summarizeOutcome(proposedTitle!, suggestedTest),
            improved,
            strictlyBetter,
            brandFix,
            autoAccepted: autoAccept,
          },
        };
      }
    }
  }
  const finalTitle = standingTitle;

  const ctx = await gatherFlagContext({
    title: doc.title,
    aiCleanedTitle: surfacedSuggestion,
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
      // Never regenerate a decided/edited suggestion (Task #1839), and never
      // regenerate taxonomy suggestions for a doc with a filed placement
      // (Task #1847) — the stored suggestion stays stable and advisory.
      ...(taxonomyLocked ? {} : { aiSuggestedCategory: result.suggestedCategory }),
      // Evidence gate (Task #1848): only a measurably-better (or brand-fixing)
      // suggestion is persisted; otherwise the suggestion slot is cleared and
      // the stored title stands untouched.
      ...(titleLocked ? {} : { aiCleanedTitle: surfacedSuggestion }),
      // Auto-accept (off-by-default admin setting): apply the strictly-better
      // suggestion as the stored title and lock the decision.
      ...(autoAccept ? { title: surfacedSuggestion!, aiTitleDecision: "accepted" } : {}),
      aiSummary: result.summary,
      ...(taxonomyLocked ? {} : { aiSuggestedTaxonomy }),
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

  if (autoAccept && surfacedSuggestion) {
    const cmp = selfTest?.titleComparison;
    await db.insert(kbTriageAuditLogTable).values({
      stagingDocId: doc.id,
      eventType: "title_auto_accepted",
      confidenceScore: null,
      actorUserId: null,
      aiReasoning: `Auto-accepted title "${surfacedSuggestion}" over "${doc.title}" (admin setting on): strictly better on every self-test question${
        cmp ? ` (${cmp.current.passedCount}/${cmp.current.total} → ${cmp.suggested.passedCount}/${cmp.suggested.total} member questions pass)` : ""
      }${cmp?.brandFix ? "; also fixes a brand/canonical-naming violation" : ""}.`,
      docTitle: surfacedSuggestion,
    });
  }

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
