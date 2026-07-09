import { db } from "@workspace/db";
import {
  kbStagingDocsTable,
  aiSourceDocumentsTable,
  aiLiveDocumentsTable,
  kbNodeSynthesisStateTable,
  kbSourceNodeExtractsTable,
  kbSynthesisRunsTable,
  type KbSynthesisRun,
  type SynthesisRunFailure,
  type SynthesisRunNodeOutcome,
} from "@workspace/db/schema";
import { sql, inArray, eq, and, desc } from "drizzle-orm";
import { recordNavGapsForNode, navDocCrossLinksMarkdown } from "./kb-nav-gaps.js";
import {
  contentWindows,
  mergeWindowExtracts,
  fingerprintContent,
  isEmptyExtract,
  partitionByBudget,
  mapWithConcurrency,
} from "./kb-source-windows.js";
import {
  ALL_NODES,
  isNode,
  AUTHORITY_ROLES,
  nodeImportance,
  relatedNodesFor,
  type AuthorityRole,
  type NodeImportance,
  type TaxonomyNode,
} from "./kb-taxonomy.js";
import {
  getNodeSourceLinks,
  getNodeLinkCounts,
  getNodeCurrentSourceIds,
  getNodeSourceIncorporationCounts,
  type NodeSource,
} from "./kb-topic-index.js";
import {
  resolveSourceContentForSynthesis,
  EMPTY_SCREENING_FLAGS,
  type ScreeningFlags,
} from "./kb-value-screener.js";
import {
  buildNavigationGroundingSection,
  applyNavigationScreen,
  getNavMapVersion,
} from "./kb-nav-grounding.js";

/**
 * Synthesis Engine (Task #1533, Part 1).
 *
 * Replaces the retired "1 transcript → 1 draft" flat-file mining. For a taxonomy
 * NODE it reads every source document the topic index linked to that node,
 * consolidates the overlapping knowledge across all of them (map → reduce), and
 * authors ONE truth-doc draft into the review queue (`kb_staging_docs`,
 * status = needs_review) carrying multi-source provenance + a corroboration
 * count. Create-only: it never updates an existing draft, and nothing
 * auto-publishes — the human gate is unchanged.
 */

type SourceDoc = NodeSource["source"];

// Full-source read (Task #1561): the map phase now walks the WHOLE of every
// source in overlapping windows (no 6k truncation) and the reduce phase folds in
// ALL linked sources (no top-N cap). Completeness is chosen over speed/cost for
// the one-time bulk run; the per-source extract cache keeps incremental re-runs
// cheap by only re-extracting sources whose content changed.
//
// Per-window map-phase output cap (each window's extract stays tight).
const MAP_EXTRACT_CHARS = 1200;
// Per-window slice of source content fed into the map phase.
const MAP_WINDOW_CHARS = 6000;
const MAP_WINDOW_OVERLAP = 1000;
// How many source documents to map (extract) concurrently. Windows within a
// single source run sequentially, so this bounds the overall LLM fan-out.
const MAP_SOURCE_CONCURRENCY = 4;
// Reduce-phase budgeting. When a node's combined per-source extracts exceed the
// char budget (or source count) for one consolidation call, they are folded in
// batches and the partial consolidations are then consolidated again
// (hierarchical reduce) so no linked source is ever silently dropped.
const REDUCE_INPUT_BUDGET_CHARS = 60000;
const REDUCE_MAX_SOURCES_PER_CALL = 40;

export interface SynthesisProgress {
  running: boolean;
  totalNodes: number;
  processedNodes: number;
  createdDrafts: number;
  // Honest per-node outcome counts (synthesis hardening).
  succeededCount: number;
  skippedCount: number;
  failedCount: number;
  failures: SynthesisRunFailure[];
  // How many LLM calls hit reasoning-token starvation (finish_reason=length)
  // and triggered a budget escalation this run.
  lengthStarvedCalls: number;
  currentNode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  runId: number | null;
}

let _state: SynthesisProgress = {
  running: false,
  totalNodes: 0,
  processedNodes: 0,
  createdDrafts: 0,
  succeededCount: 0,
  skippedCount: 0,
  failedCount: 0,
  failures: [],
  lengthStarvedCalls: 0,
  currentNode: null,
  startedAt: null,
  finishedAt: null,
  error: null,
  runId: null,
};

export function getSynthesisState(): SynthesisProgress {
  return { ..._state };
}

export function isSynthesisRunning(): boolean {
  return _state.running;
}

// ── Depth ladder ────────────────────────────────────────────────────────────
//
// The node's ROOT sets the published doc_class target + depth ceiling:
//  - process     → overview  (a checklist/roadmap for a lifecycle stage; operational)
//  - concepts    → curated   (a deep explainer of a marketing skill; conceptual)
//  - operations  → curated   (how the membership / support works; operational)

function depthTierFor(node: TaxonomyNode): { docClassTarget: "overview" | "curated"; ceiling: string } {
  if (node.root === "process") return { docClassTarget: "overview", ceiling: "operational" };
  if (node.root === "concepts") return { docClassTarget: "curated", ceiling: "conceptual" };
  return { docClassTarget: "curated", ceiling: "operational" };
}

// Authority precedence (Task #1751): the CURRICULUM is the canonical foundation
// — where it covers a topic it outranks coaching commentary, which supplements
// with judgment (the why / when / what-if) rather than overriding. VA content
// never drives strategy claims. Exported so the precedence is unit-testable.
export const AUTHORITY_RANK: Readonly<Record<AuthorityRole, number>> = {
  curriculum: 3,
  strategic_coach: 2,
  va: 1,
  internal: 0,
};

/** The strongest authority present among a node's sources (drives the draft's authorityRole). */
function dominantAuthority(sources: SourceDoc[]): AuthorityRole {
  let best: AuthorityRole = "internal";
  for (const s of sources) {
    const role = (AUTHORITY_ROLES as readonly string[]).includes(s.authorityRole as string)
      ? (s.authorityRole as AuthorityRole)
      : "internal";
    if (AUTHORITY_RANK[role] > AUTHORITY_RANK[best]) best = role;
  }
  return best;
}

// ── LLM plumbing ────────────────────────────────────────────────────────────

// Retry budgets (synthesis hardening — mirrors the topic-index classifier).
// Rate limits (429) get more attempts + much longer backoff: the generic
// 1s/3s schedule converts a transient 429 burst into degraded output.
// gpt-5 is a reasoning model: its (invisible) reasoning tokens count against
// max_completion_tokens. Tight budgets return 200 OK with EMPTY content +
// finish_reason=length — the dev pilot showed the old 700-token map budget
// starving on every call (previously masked by the raw-window fallback). Give
// thousands of tokens of headroom above the visible output size.
const MAP_EXTRACT_MAX_TOKENS = 4000;      // visible output capped at ~1200 chars
const CONSOLIDATE_MAX_TOKENS = 16000;     // full truth-doc + reasoning headroom
const ATOMIC_DEFS_MAX_TOKENS = 5000;      // small JSON + reasoning headroom
const REVISION_DIFF_MAX_TOKENS = 4000;    // few bullets + reasoning headroom
const LLM_TIMEOUT_MS = 180_000;

const LLM_MAX_ATTEMPTS = 3;
const LLM_RETRY_BACKOFF_MS = [1000, 3000];
const LLM_MAX_ATTEMPTS_429 = 5;
const LLM_RETRY_BACKOFF_429_MS = [5000, 15000, 30000, 60000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when an LLM error message indicates a rate limit (429). Exported for tests. */
export function isRateLimitError(msg: string): boolean {
  return msg.includes("429");
}

/**
 * True when an LLM error message indicates reasoning-token starvation — a 200 OK
 * with empty content and finish_reason=length (the model spent the whole
 * max_completion_tokens budget on invisible reasoning). Exported for tests.
 */
export function isLengthStarvationError(msg: string): boolean {
  return msg.includes("finish_reason=length");
}

// Budget-escalation ceiling: a starved call doubles its token budget per
// attempt (4k→8k→16k…), never beyond this cap.
export const LLM_ESCALATION_MAX_TOKENS = 32000;

// Per-run tally of length-starved calls (how often escalation kicked in).
// Reset at the start of each synthesis run; surfaced in state + run report.
let _lengthStarvedCalls = 0;
export function getLengthStarvedCallCount(): number {
  return _lengthStarvedCalls;
}
export function resetLengthStarvedCallCount(): void {
  _lengthStarvedCalls = 0;
}

export async function callLLM(system: string, user: string, maxTokens: number, jsonMode = false): Promise<string> {
  const base = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!base || !key) throw new Error("AI integration is not configured");

  const resp = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      max_completion_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`AI synthesis call failed: ${resp.status}`);
  const json = (await resp.json()) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
  };
  const content = (json.choices?.[0]?.message?.content ?? "").trim();
  // Reasoning-token starvation returns 200 OK with EMPTY content and
  // finish_reason=length. That is a FAILURE, never a valid empty answer —
  // treating it as output was the topic-index silent-degradation bug.
  if (!content) {
    const finish = json.choices?.[0]?.finish_reason ?? "unknown";
    throw new Error(`AI synthesis call returned empty content (finish_reason=${finish})`);
  }
  return content;
}

/**
 * callLLM with bounded retries + rate-limit-aware backoff. Throws only after
 * all attempts are exhausted — callers must treat that throw as a real failure
 * (loud), never substitute silent fallback content.
 */
export async function callLLMWithRetry(
  label: string,
  system: string,
  user: string,
  maxTokens: number,
  jsonMode = false,
  // Only SYNTHESIS-run calls should feed the per-run length-starved tally;
  // this helper is also reused by triage/refine, whose starvations must not
  // inflate synthesis run metrics. Synthesis call sites pass true.
  countStarvation = false,
): Promise<string> {
  let lastErr: unknown;
  let attempt = 0;
  let maxAttempts = LLM_MAX_ATTEMPTS;
  // Budget escalation: reasoning-token starvation (200 OK, empty content,
  // finish_reason=length) is deterministic for a given prompt+budget — plain
  // retries at the same budget just fail identically. Double the budget on each
  // starved attempt instead (e.g. 4k→8k→16k), capped at LLM_ESCALATION_MAX_TOKENS.
  let currentMaxTokens = maxTokens;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await callLLM(system, user, currentMaxTokens, jsonMode);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const rateLimited = isRateLimitError(msg);
      const starved = isLengthStarvationError(msg);
      if (rateLimited) maxAttempts = LLM_MAX_ATTEMPTS_429;
      if (starved) {
        if (countStarvation) _lengthStarvedCalls += 1;
        currentMaxTokens = Math.min(currentMaxTokens * 2, LLM_ESCALATION_MAX_TOKENS);
      }
      console.error(
        `[Synthesis] ${label} attempt ${attempt}/${maxAttempts} failed: ${msg}` +
          (starved && attempt < maxAttempts ? ` — escalating budget to ${currentMaxTokens} tokens` : ""),
      );
      if (attempt < maxAttempts) {
        const schedule = rateLimited ? LLM_RETRY_BACKOFF_429_MS : LLM_RETRY_BACKOFF_MS;
        await sleep(schedule[Math.min(attempt - 1, schedule.length - 1)]);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ── Hearsay guard (Task: keep member hearsay out of truth docs) ──────────────
//
// Coaching-call transcripts contain MEMBER speech. A member's recollection of
// policy/billing/refund/guarantee terms is HEARSAY, not fact — it must never be
// extracted into a truth doc. Only COACH-stated guidance counts. The guard text
// is shared by the map (extraction) and reduce (consolidation) prompts so
// hearsay can neither enter an extract nor be reintroduced during consolidation.
export const HEARSAY_GUARD = `HEARSAY GUARD: transcript sources may contain MEMBER speech (lines labeled "Member:" or member questions). Member-reported claims about policies, billing, refunds, guarantees, pricing, or support terms (e.g. "I was told there's a 90-day guarantee", "they charged me twice") are HEARSAY — NEVER extract or state them as facts, even when the coach does not dispute them. Only guidance, facts and policy statements the COACH themselves states are usable. This changes nothing about extracting general teaching content.`;

// Bump this version whenever the map/reduce extraction prompts change in a way
// that should invalidate previously-cached extracts. It is folded into the
// per-(source,node) extract-cache fingerprint, so a prompt change automatically
// forces re-extraction on the next run — no manual DB surgery. (The fingerprint
// is otherwise content-based, so a prompt-only change would NOT bust the cache.)
export const EXTRACT_PROMPT_VERSION = "v3-authority-and-screener-flags";

// Flag-preservation guard (Task #1751): the screened representation prefixes
// risky kept segments with inline markers ([SITUATIONAL NUMBER …],
// [CONTEXT-BOUND WALKTHROUGH …], [SEGMENT ANOMALY …]). The map phase must carry
// those signals onto the extracted bullets so they survive into consolidation
// instead of being flattened away with the passage text.
export const FLAG_PRESERVATION_GUARD = `FLAG PRESERVATION: the source may prefix passages with markers like [SITUATIONAL NUMBER …], [CONTEXT-BOUND WALKTHROUGH …] or [SEGMENT ANOMALY …]. When a bullet draws on a marked passage, begin that bullet with the matching short tag — [SITUATIONAL], [CONTEXT-BOUND] or [ANOMALY]. For [SITUATIONAL] bullets, keep the member-specific context attached to the figure (e.g. "in one member's case, spending $X…") and NEVER restate such numbers as general targets, benchmarks or recommendations.`;

// Map phase (one window): pull the node-relevant knowledge out of one slice of a
// source, discarding the rest. Keeps each extraction focused and within budget.
// Exported prompt builder so the hearsay-guard contract is unit-testable.
export function buildMapExtractSystemPrompt(node: TaxonomyNode): string {
  return `You extract ONLY the material relevant to a specific topic from a BTS (Build Test Scale) affiliate-marketing source document.
TOPIC: "${node.label}".
Return a tight bullet list of the concrete, usable facts / steps / guidance this source gives about that topic. Omit anything off-topic, pleasantries and filler. If the source says nothing usable about the topic, return exactly "NONE".
${HEARSAY_GUARD}
${FLAG_PRESERVATION_GUARD}
No preamble. Under ${MAP_EXTRACT_CHARS} characters.`;
}

async function extractWindowForNode(node: TaxonomyNode, source: SourceDoc, window: string, windowIndex: number): Promise<string> {
  const system = buildMapExtractSystemPrompt(node);
  const user = `SOURCE TITLE: ${source.title}\n\nSOURCE CONTENT:\n${window}`;
  return callLLMWithRetry(`map extract source ${source.id} node ${node.slug} window ${windowIndex}`, system, user, MAP_EXTRACT_MAX_TOKENS, false, true);
}

// Map phase (whole source): walk EVERY window of the source and merge the
// per-window extracts into one, so material past the old 6k cutoff is no longer
// dropped. Returns the "NONE" marker when nothing usable was found. Windows run
// sequentially within a source (the per-source fan-out is bounded by the caller).
//
// Hardening: a window that fails after its retry budget FAILS the whole source
// extract (throws). The old behavior — silently substituting the raw window
// text, which then got CACHED under the content fingerprint as if it were a
// successful extract — is gone: a failure is loud, recorded, and retried on the
// next run.
async function extractForNode(node: TaxonomyNode, source: SourceDoc): Promise<string> {
  const windows = contentWindows(source.content, MAP_WINDOW_CHARS, MAP_WINDOW_OVERLAP);
  const fragments: string[] = [];
  for (let i = 0; i < windows.length; i++) {
    fragments.push(await extractWindowForNode(node, source, windows[i], i));
  }
  return mergeWindowExtracts(fragments);
}

// Cached map phase: reuse the finished extract for a (source, node) when the
// source content is unchanged (fingerprint match), otherwise re-extract and
// upsert. This is what keeps incremental re-runs cheap now that the map phase
// reads the whole source and the reduce folds in every linked source.
async function getOrExtractForNode(
  node: TaxonomyNode,
  source: SourceDoc,
): Promise<{ extract: string; flags: ScreeningFlags }> {
  // Resolve the screened kept-segments representation (raw when no valid
  // screening exists), WITH inline flag markers so the risk signals travel
  // through extraction. The cache fingerprint is computed on the RESOLVED text
  // so an admin keep/drop overrule or a re-screen invalidates the extract and
  // it is re-run against the new content on the next synthesis. The aggregate
  // flags are recomputed on every run (they are cheap and never cached), so a
  // cached extract still carries fresh flags into consolidation.
  const { content: resolvedContent, excluded, flags } = await resolveSourceContentForSynthesis(
    source.id,
    source.content ?? "",
    { annotateFlags: true },
  );
  // A duplicate-screened source contributes NOTHING to synthesis — the
  // original source carries the content. "NONE" is the map phase's standard
  // nothing-usable marker, so downstream folding drops it naturally.
  if (excluded) return { extract: "NONE", flags };
  const resolvedSource: SourceDoc = { ...source, content: resolvedContent };
  // Fingerprint = prompt version + resolved (screened) content, so BOTH a
  // content/overrule change AND an extraction-prompt change invalidate the
  // cached extract. Content-only fingerprints would keep serving extracts
  // produced under a superseded prompt (e.g. pre-hearsay-guard).
  const fingerprint = fingerprintContent(`${EXTRACT_PROMPT_VERSION}\n${resolvedContent}`);
  try {
    const cached = await db
      .select({
        extract: kbSourceNodeExtractsTable.extract,
        contentFingerprint: kbSourceNodeExtractsTable.contentFingerprint,
        status: kbSourceNodeExtractsTable.status,
      })
      .from(kbSourceNodeExtractsTable)
      .where(
        and(
          eq(kbSourceNodeExtractsTable.sourceDocId, source.id),
          eq(kbSourceNodeExtractsTable.node, node.slug),
        ),
      )
      .limit(1);
    // A cache hit requires the fingerprint AND an honest 'ok' outcome. A row
    // with status='failed' is a durable failure record, never reusable output —
    // reruns fall through here and retry the extraction (self-heal).
    if (cached[0] && cached[0].contentFingerprint === fingerprint && cached[0].status === "ok") {
      return { extract: cached[0].extract, flags };
    }
  } catch (err) {
    // A cache read failure must never block synthesis — fall through to extract.
    console.error(`[Synthesis] extract-cache read failed for source ${source.id} / node ${node.slug}:`, err instanceof Error ? err.message : err);
  }

  let extract: string;
  try {
    extract = await extractForNode(node, resolvedSource);
  } catch (err) {
    // Extraction failed after all retries. Record the failure DURABLY (so run
    // reports and reruns see it) and rethrow — never cache fallback content as
    // if it succeeded.
    const message = err instanceof Error ? err.message : String(err);
    try {
      await db
        .insert(kbSourceNodeExtractsTable)
        .values({ sourceDocId: source.id, node: node.slug, contentFingerprint: fingerprint, extract: "", status: "failed", error: message })
        .onConflictDoUpdate({
          target: [kbSourceNodeExtractsTable.sourceDocId, kbSourceNodeExtractsTable.node],
          set: { contentFingerprint: fingerprint, extract: "", status: "failed", error: message, updatedAt: new Date() },
        });
    } catch (persistErr) {
      console.error(`[Synthesis] failed to persist extract failure for source ${source.id} / node ${node.slug}:`, persistErr instanceof Error ? persistErr.message : persistErr);
    }
    throw err;
  }

  try {
    await db
      .insert(kbSourceNodeExtractsTable)
      .values({ sourceDocId: source.id, node: node.slug, contentFingerprint: fingerprint, extract, status: "ok", error: null })
      .onConflictDoUpdate({
        target: [kbSourceNodeExtractsTable.sourceDocId, kbSourceNodeExtractsTable.node],
        set: { contentFingerprint: fingerprint, extract, status: "ok", error: null, updatedAt: new Date() },
      });
  } catch (err) {
    // Persisting the cache is best-effort; the extract is still returned/used.
    console.error(`[Synthesis] extract-cache write failed for source ${source.id} / node ${node.slug}:`, err instanceof Error ? err.message : err);
  }
  return { extract, flags };
}

/** Union of per-source screening flags (used when folding batches in the
 *  hierarchical reduce so no flag is lost between consolidation rounds). */
export function mergeScreeningFlags(list: ScreeningFlags[]): ScreeningFlags {
  return {
    situationalNumbers: list.some((f) => f.situationalNumbers),
    contextBound: list.some((f) => f.contextBound),
    segmentAnomaly: list.some((f) => f.segmentAnomaly),
  };
}

/** Render an entry's screening flags for the consolidation source header. */
export function screeningFlagsLabel(flags: ScreeningFlags): string {
  const parts: string[] = [];
  if (flags.situationalNumbers) parts.push("situational-numbers");
  if (flags.contextBound) parts.push("context-bound-walkthrough");
  if (flags.segmentAnomaly) parts.push("segment-anomaly");
  return parts.length ? `, flags=${parts.join("+")}` : "";
}

// One consolidation input: a per-source (or per-batch, during hierarchical
// reduce) extract plus the provenance the prompt renders. Structural so a
// SourceDoc (which has these fields and more) is assignable, and so a synthetic
// batch "source" can stand in during the hierarchical reduce.
interface ConsolidateEntry {
  source: { sourceType: string | null; authorityRole: string | null };
  relevance: number;
  extract: string;
  // Per-source screener risk signals (union of the kept segments' flags),
  // rendered into the source header so consolidation treats flagged material
  // correctly and the flags survive the hierarchical reduce.
  flags: ScreeningFlags;
}

// Consolidation prompt contract (Task #1751), exported for unit tests.
// Real conflicts must reach the reviewer VISIBLY — this exact marker is what
// the prompt instructs the model to emit, so the review UI/reviewer can spot it.
export const SOURCE_CONFLICT_MARKER = "> ⚠️ SOURCE CONFLICT (for reviewer):";

export const AUTHORITY_PRECEDENCE_RULES = `AUTHORITY PRECEDENCE (see the authority= label on each source):
- curriculum is the canonical foundation. On any foundation the curriculum covers, the curriculum's guidance WINS; coaching (strategic_coach) material SUPPLEMENTS it with judgment — the why, the when, the what-ifs and edge cases — and never overrides or contradicts it. Coaching guidance leads only where the curriculum is silent.
- va sources may contribute operational/logistical detail but must NEVER drive strategy claims or teaching positions.
- Otherwise, sources are co-equal.
CONFLICTS: when co-equal sources GENUINELY disagree on substance (this excludes a curriculum-covered foundation, where curriculum simply wins), do NOT silently resolve it or pick one side. Keep both positions and add a visible blockquote line starting exactly "${SOURCE_CONFLICT_MARKER}" that states the disagreement plainly, so a human reviewer decides.`;

export const SITUATIONAL_NUMBER_RULES = `SITUATIONAL NUMBERS: material tagged [SITUATIONAL] (or from a source flagged situational-numbers) contains figures tied to ONE member's situation or a point in time. Such numbers may appear ONLY as context-bound illustrations WITH their context (e.g. "in one member's case, spending $40/day…") — NEVER as universal targets, benchmarks, thresholds or recommendations. [CONTEXT-BOUND] walkthrough narration is topic evidence, not standalone quotable teaching — use it to inform the doc, don't transcribe it.`;

export const NO_MEMBER_NAMES_RULE = `never include member names — refer to members generically ("a member", "one member")`;

// Exported so the consolidation prompt contract is unit-testable (mirrors
// buildMapExtractSystemPrompt).
export function buildConsolidateSystemPrompt(node: TaxonomyNode, depthGuidance: string): string {
  // Genuinely adjacent topics only (curated NODE_NEIGHBORS), not every sibling
  // in the root — keeps prose cross-links on-subject.
  const relatedNodes = relatedNodesFor(node.slug)
    .map((n) => n.label)
    .join(", ");

  return `You are the BTS (Build Test Scale) knowledge synthesist. You consolidate knowledge that appears across MANY source documents into ONE authoritative truth document for a single topic node.
TOPIC NODE: "${node.label}" (root: ${node.root}).
${depthGuidance}
RULES:
- Consolidate — merge overlapping points, resolve small redundancies, present the collective best understanding. Do NOT just concatenate the sources.
- ${AUTHORITY_PRECEDENCE_RULES}
- CURRICULUM PAIRING: where coaching insight relates to a curriculum-covered foundation, attach it AROUND that foundation (present the curriculum position first, then the coaching judgment that builds on it) — never as a competing alternative.
- ${SITUATIONAL_NUMBER_RULES}
- ${HEARSAY_GUARD}
- Layer the doc: a summary/orientation first, then the detail.
- Add brief cross-links in prose to closely related topics where natural (related here: ${relatedNodes || "n/a"}).
- BRAND RULES: say "Build Test Scale" / "BTS" (never "TCE" or "Cherrington"); no coach surnames; ${NO_MEMBER_NAMES_RULE}; support email is support@buildtestscale.com.
- ${buildNavigationGroundingSection()}
- Output MARKDOWN only. First line MUST be a single "# Title" heading, then the body. No preamble, no meta commentary about sources.`;
}

// Reduce phase: consolidate the per-source extracts into ONE layered truth doc.
async function consolidate(
  node: TaxonomyNode,
  tier: { docClassTarget: string; ceiling: string },
  extracts: ConsolidateEntry[],
): Promise<{ title: string; body: string }> {
  const depthGuidance = tier.docClassTarget === "overview"
    ? `Write an OVERVIEW: a clear checklist/roadmap for this lifecycle stage — what to do, in order, with the key decision points. Operational depth.`
    : `Write a CURATED explainer: lead with a short plain-language summary, then go deep on the concept with the reasoning, examples and nuances the sources support. Conceptual depth.`;

  const numbered = extracts
    .map((e, i) => `[SOURCE ${i + 1}] (${e.source.sourceType}, authority=${e.source.authorityRole ?? "internal"}${screeningFlagsLabel(e.flags)})\n${e.extract}`)
    .join("\n\n");

  const system = buildConsolidateSystemPrompt(node, depthGuidance);

  const user = `Consolidate the following ${extracts.length} source extract(s) into one truth document for "${node.label}".\n\n${numbered}`;

  const out = await callLLMWithRetry(`consolidate node ${node.slug}`, system, user, CONSOLIDATE_MAX_TOKENS, false, true);
  if (!out) throw new Error("AI returned an empty synthesis");

  // Split off the leading "# Title".
  const lines = out.split("\n");
  let title = node.label;
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#\s+(.+?)\s*$/);
    if (m) {
      title = m[1].trim();
      bodyStart = i + 1;
      break;
    }
    if (lines[i].trim() !== "") break; // non-heading content first → no title line
  }
  const body = lines.slice(bodyStart).join("\n").trim() || out;
  return { title, body };
}

// Reduce phase (hierarchical): consolidate EVERY linked source's extract — no
// top-N cap. When the combined extracts exceed the per-call budget (chars or
// source count), fold them in batches and then consolidate the partial
// consolidations again (recursively) so no source is ever silently dropped. The
// title comes from the final (outermost) consolidation.
async function consolidateAll(
  node: TaxonomyNode,
  tier: { docClassTarget: string; ceiling: string },
  extracts: ConsolidateEntry[],
): Promise<{ title: string; body: string }> {
  const sizeOf = (e: ConsolidateEntry) => e.extract.length + 64;
  const totalChars = extracts.reduce((n, e) => n + sizeOf(e), 0);
  const fits = extracts.length <= REDUCE_MAX_SOURCES_PER_CALL && totalChars <= REDUCE_INPUT_BUDGET_CHARS;
  if (fits) return consolidate(node, tier, extracts);

  const batches = partitionByBudget(extracts, sizeOf, REDUCE_INPUT_BUDGET_CHARS, REDUCE_MAX_SOURCES_PER_CALL);
  // A single oversized item can still yield one batch — consolidate it directly
  // rather than recursing forever.
  if (batches.length <= 1) return consolidate(node, tier, extracts);

  const partials: ConsolidateEntry[] = [];
  for (const batch of batches) {
    const { body } = await consolidate(node, tier, batch);
    partials.push({
      source: {
        sourceType: "consolidated-batch",
        authorityRole: dominantAuthority(batch.map((e) => e.source as SourceDoc)),
      },
      relevance: 1,
      extract: body,
      // Union of the batch's flags so the risk signals survive every fold of
      // the hierarchical reduce, not just the first consolidation round.
      flags: mergeScreeningFlags(batch.map((e) => e.flags)),
    });
  }
  // The partials may themselves exceed the budget — fold again.
  return consolidateAll(node, tier, partials);
}

// ── Depth-ladder cross-linking ────────────────────────────────────────────────
//
// Deterministic (non-LLM) cross-link contract so the depth ladder is always
// wired both ways: an OVERVIEW (process stage) points down to the CONCEPT deep
// dives, and a CURATED concept points up to the process stages where it applies.
// Appended verbatim to every synthesized body so the structure never depends on
// the model remembering to add prose links.
// Tightened (Task: tighten "Related topics"): instead of dumping EVERY sibling
// in the root(s) — the boilerplate the reviewers flagged — the section is built
// from the node's curated NODE_NEIGHBORS adjacency (kb-taxonomy), grouped under
// the same depth-ladder headers. Exported for unit tests.
export function relatedTopicsMarkdown(node: TaxonomyNode): string {
  const neighbors = relatedNodesFor(node.slug);
  const bullets = (root: TaxonomyNode["root"]) =>
    neighbors.filter((n) => n.root === root).map((n) => `- ${n.label}`);

  const sections: string[] = [];
  if (node.root === "process") {
    const concepts = bullets("concepts");
    if (concepts.length) sections.push(`**Go deeper — the skills behind this stage:**\n${concepts.join("\n")}`);
    const stages = bullets("process");
    if (stages.length) sections.push(`**Adjacent stages:**\n${stages.join("\n")}`);
  } else if (node.root === "concepts") {
    const stages = bullets("process");
    if (stages.length) sections.push(`**Where this applies — process stages:**\n${stages.join("\n")}`);
    const concepts = bullets("concepts");
    if (concepts.length) sections.push(`**Related concepts:**\n${concepts.join("\n")}`);
  } else {
    const siblings = bullets(node.root);
    if (siblings.length) sections.push(`**Related topics:**\n${siblings.join("\n")}`);
  }
  return sections.length ? `\n\n## Related topics\n${sections.join("\n\n")}` : "";
}

// ── Atomic definition docs ────────────────────────────────────────────────────
//
// Beyond the one consolidated truth-doc, a node's material often defines reusable
// terms that deserve their OWN short standalone doc (e.g. "What is an angle?").
// This surfaces up to a few such terms so the reviewer gets an atomic definition
// draft alongside the main draft. Create-only, needs_review — never auto-links.
interface AtomicDefinition {
  term: string;
  definition: string;
}

const MAX_ATOMIC_DEFS_PER_NODE = 3;

// Exported for the prompt-contract test (Task #1808): short "What is X?"
// definition docs get the SAME navigation grounding as the main consolidation
// prompt, so they can never repeat stale old-portal navigation from sources.
export function buildAtomicDefinitionSystemPrompt(): string {
  return `You review consolidated BTS (Build Test Scale) affiliate-marketing material for ONE topic and identify KEY TERMS that deserve their own short standalone definition document (like an entry answering "What is an angle?").
Only include a term when the material actually DEFINES or explains it AND it is a reusable concept a member would look up on its own — never a passing mention. Return AT MOST ${MAX_ATOMIC_DEFS_PER_NODE}.
Return ONLY JSON: {"definitions":[{"term":"<the term>","definition":"<2-4 sentence plain-language definition in member vocabulary>"}]}. Return {"definitions":[]} if none qualify.
BRAND RULES: say "Build Test Scale" / "BTS" (never "TCE" or "Cherrington"); no coach surnames; ${NO_MEMBER_NAMES_RULE}.
${buildNavigationGroundingSection()}`;
}

async function extractAtomicDefinitions(
  node: TaxonomyNode,
  extracts: { source: SourceDoc; extract: string }[],
): Promise<AtomicDefinition[]> {
  const system = buildAtomicDefinitionSystemPrompt();
  const user = `TOPIC NODE: "${node.label}" (root: ${node.root}).\n\nMATERIAL:\n${extracts
    .map((e, i) => `[SOURCE ${i + 1}]\n${e.extract}`)
    .join("\n\n")}`;
  try {
    const raw = await callLLMWithRetry(`atomic definitions node ${node.slug}`, system, user, ATOMIC_DEFS_MAX_TOKENS, true, true);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { definitions?: unknown };
    if (!Array.isArray(parsed.definitions)) return [];
    return parsed.definitions
      .filter(
        (d): d is AtomicDefinition =>
          !!d &&
          typeof (d as AtomicDefinition).term === "string" &&
          typeof (d as AtomicDefinition).definition === "string" &&
          (d as AtomicDefinition).term.trim().length > 0 &&
          (d as AtomicDefinition).definition.trim().length > 0,
      )
      .slice(0, MAX_ATOMIC_DEFS_PER_NODE)
      .map((d) => ({ term: d.term.trim(), definition: d.definition.trim() }));
  } catch (err) {
    console.error(`[Synthesis] atomic-definition extraction failed for node ${node.slug}:`, err instanceof Error ? err.message : err);
    return [];
  }
}

export interface SynthesizeResult {
  node: string;
  draftId: number | null;
  atomicDraftIds: number[];
  sourceCount: number;
  skippedReason?: string;
}

// ── Update-vs-create resolution (Part 3, Task #1535) ─────────────────────────
//
// When a node already has a PUBLISHED, citable Live AI Document, a fresh
// synthesis of that node must propose a REVISION of that doc — routed through the
// same human gate — instead of creating an orphan duplicate. These helpers find
// the live doc a draft should supersede.

interface LiveDocMatch {
  id: number;
  title: string;
  content: string;
}

// The MAIN consolidated truth-doc for a node: citable, non-atomic (atomic "What
// is …?" definition docs are matched separately by exact title), most-recently
// updated. Null when the node has no published doc yet (→ create-new).
async function findLiveDocForNode(nodeSlug: string): Promise<LiveDocMatch | null> {
  const rows = await db
    .select({
      id: aiLiveDocumentsTable.id,
      title: aiLiveDocumentsTable.title,
      content: aiLiveDocumentsTable.content,
    })
    .from(aiLiveDocumentsTable)
    .where(sql`
      ${aiLiveDocumentsTable.node} = ${nodeSlug}
      AND ${aiLiveDocumentsTable.docClass} IN ('curated','overview')
      AND ${aiLiveDocumentsTable.lastVerified} IS NOT NULL
      AND ${aiLiveDocumentsTable.audience} <> 'admin'
      AND ${aiLiveDocumentsTable.deletedAt} IS NULL
      AND ${aiLiveDocumentsTable.title} NOT ILIKE 'What is %'
    `)
    .orderBy(desc(aiLiveDocumentsTable.updatedAt))
    .limit(1);
  return rows[0] ?? null;
}

// Exact-title match for an atomic definition doc ("What is X?").
async function findLiveDocByTitle(title: string): Promise<LiveDocMatch | null> {
  const rows = await db
    .select({
      id: aiLiveDocumentsTable.id,
      title: aiLiveDocumentsTable.title,
      content: aiLiveDocumentsTable.content,
    })
    .from(aiLiveDocumentsTable)
    .where(sql`
      ${aiLiveDocumentsTable.title} = ${title}
      AND ${aiLiveDocumentsTable.docClass} IN ('curated','overview')
      AND ${aiLiveDocumentsTable.lastVerified} IS NOT NULL
      AND ${aiLiveDocumentsTable.audience} <> 'admin'
      AND ${aiLiveDocumentsTable.deletedAt} IS NULL
    `)
    .limit(1);
  return rows[0] ?? null;
}

// Best-effort human-readable diff of what a revision adds/changes vs the current
// published version. Falls back to a source-based summary when the LLM is
// unavailable so the reviewer always sees *why* this is a proposed update.
async function summarizeRevision(
  node: TaxonomyNode,
  priorContent: string,
  newContent: string,
  newSourceNames: string[],
): Promise<string> {
  const fallback =
    newSourceNames.length > 0
      ? `Incorporates ${newSourceNames.length} new source(s): ${newSourceNames.slice(0, 5).join("; ")}${newSourceNames.length > 5 ? "; …" : ""}.`
      : "Revised consolidation reflecting the latest source material for this topic.";
  try {
    const system = `You compare a CURRENTLY PUBLISHED knowledge document with a PROPOSED REVISION of it and summarize, in 2-5 short markdown bullet points, what the revision ADDS, CHANGES or CORRECTS. Focus on substance a reviewer must check. Bullets only, no preamble. If nothing material changed, output exactly "- No material change; refreshed consolidation."`;
    const user = `TOPIC: "${node.label}"\n\n=== CURRENTLY PUBLISHED ===\n${priorContent.slice(0, 6000)}\n\n=== PROPOSED REVISION ===\n${newContent.slice(0, 6000)}`;
    const out = await callLLMWithRetry(`revision diff node ${node.slug}`, system, user, REVISION_DIFF_MAX_TOKENS, false, true);
    return out?.trim() || fallback;
  } catch (err) {
    console.error(`[Synthesis] revision diff failed for node ${node.slug}:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

/**
 * Synthesize ONE node into a single truth-doc draft. When the node already has a
 * published Live AI Document, the draft is authored as a REVISION of it (update
 * kind, target link, diff summary) so the human gate can supersede the current
 * version instead of publishing an orphan duplicate. Returns the created draft
 * id (or a skip reason when the node has no linked sources).
 */
export async function synthesizeNode(nodeSlug: string): Promise<SynthesizeResult> {
  const node = ALL_NODES.find((n) => n.slug === nodeSlug);
  if (!node) throw new Error(`Unknown taxonomy node: ${nodeSlug}`);

  const linked = await getNodeSourceLinks(node.slug);
  if (linked.length === 0) {
    return { node: node.slug, draftId: null, atomicDraftIds: [], sourceCount: 0, skippedReason: "no linked sources" };
  }

  // Which source docs were already synthesized for this node last time — used to
  // flag genuinely-NEW material as the provenance behind a proposed revision.
  const priorState = await db
    .select({ sourceDocIds: kbNodeSynthesisStateTable.sourceDocIds })
    .from(kbNodeSynthesisStateTable)
    .where(eq(kbNodeSynthesisStateTable.node, node.slug))
    .limit(1);
  const priorSourceIds = new Set<number>(
    Array.isArray(priorState[0]?.sourceDocIds) ? (priorState[0]!.sourceDocIds as number[]) : [],
  );

  const tier = depthTierFor(node);

  // Map: extract node-relevant material from EVERY linked source (no top-N cap),
  // reading the whole source. The extract cache makes unchanged sources cheap on
  // re-runs; concurrency is bounded per source (windows within a source are
  // sequential).
  const extracts = await mapWithConcurrency(
    linked,
    MAP_SOURCE_CONCURRENCY,
    async (l) => {
      const { extract, flags } = await getOrExtractForNode(node, l.source);
      return { source: l.source, relevance: l.link.relevance, extract, flags };
    },
  );

  // Drop sources that had nothing usable for this node.
  const usable = extracts.filter((e) => !isEmptyExtract(e.extract));
  if (usable.length === 0) {
    return { node: node.slug, draftId: null, atomicDraftIds: [], sourceCount: 0, skippedReason: "no usable material after extraction" };
  }

  // Reduce: consolidate ALL usable sources into one layered draft (hierarchically
  // when they exceed a single call's budget), then append the deterministic
  // depth-ladder cross-link section so overview↔concept docs are always wired.
  const { title, body: consolidated } = await consolidateAll(node, tier, usable);
  // Deterministic nav-doc cross-links (Task #1776): concept/process docs keep
  // click-paths OUT of prose and point at published navigation walkthroughs for
  // the apps their material references. Best-effort — never blocks the draft.
  let navCrossLinks = "";
  if (node.root === "process" || node.root === "concepts") {
    try {
      navCrossLinks = await navDocCrossLinksMarkdown(usable.map((e) => e.extract));
    } catch (err) {
      console.error(`[Synthesis] nav-doc cross-linking failed for node ${node.slug}:`, err instanceof Error ? err.message : err);
    }
  }
  // Deterministic navigation screen: if the model ignored the navigation
  // grounding and a legacy portal-location phrase survived, append a visible
  // NAVIGATION CONFLICT callout so it is rewritten or flagged — never silent.
  const body = applyNavigationScreen(consolidated) + relatedTopicsMarkdown(node) + navCrossLinks;
  const navMapVersion = getNavMapVersion();

  const contributing = usable.map((e) => e.source);
  const authorityRole = dominantAuthority(contributing);
  const synthesisSources = usable.map((e) => ({
    sourceDocId: e.source.id,
    sourceType: e.source.sourceType ?? null,
    authorityRole: e.source.authorityRole ?? null,
    sourceName: e.source.sourceName ?? null,
    transcriptSourceId: e.source.sourceId ?? null,
    relevance: e.relevance,
    isNew: !priorSourceIds.has(e.source.id),
  }));

  // New-material provenance: the sources that weren't part of the last synthesis.
  const newSourceNames = usable
    .filter((e) => !priorSourceIds.has(e.source.id))
    .map((e) => e.source.sourceName?.trim() || e.source.title)
    .filter((n): n is string => !!n);

  // Resolve whether this node already has a published Live AI Document. If so the
  // draft is a REVISION of it: keep the published title stable, link the target,
  // and author a diff summary so the reviewer sees what changed. Otherwise it is
  // a brand-new doc (create path, unchanged).
  const existingLive = await findLiveDocForNode(node.slug);
  const mainTitle = existingLive ? existingLive.title : title;
  const mainUpdateKind = existingLive ? "update" : "new";
  const mainTargetLiveDocId = existingLive?.id ?? null;
  const mainUpdateSummary = existingLive
    ? await summarizeRevision(node, existingLive.content, body, newSourceNames)
    : null;

  const sourcesSummary = contributing
    .map((s) => s.sourceName?.trim() || s.title)
    .filter(Boolean)
    .join("; ")
    .slice(0, 1000);

  const [draft] = await db
    .insert(kbStagingDocsTable)
    .values({
      title: mainTitle,
      content: body,
      category: node.root,
      homeRoot: node.root,
      node: node.slug,
      docType: "truth_draft",
      originType: "ai_synthesized",
      authorityRole,
      docClassTarget: tier.docClassTarget,
      ceiling: tier.ceiling,
      status: "needs_review",
      corroborationCount: usable.length,
      synthesisSources,
      sourceVideoTitle: sourcesSummary || null,
      updateKind: mainUpdateKind,
      targetLiveDocId: mainTargetLiveDocId,
      updateSummary: mainUpdateSummary,
      navMapVersion,
      aiSuggestedTaxonomy: {
        homeRoot: node.root,
        node: node.slug,
        docClass: tier.docClassTarget,
        ceiling: tier.ceiling,
      },
    })
    .returning({ id: kbStagingDocsTable.id });

  _state.createdDrafts += 1;

  // Atomic definition docs: reusable terms the material defines that deserve
  // their own standalone doc. Each becomes its own create-only, needs_review
  // draft (curated/conceptual), carrying the same multi-source provenance.
  const atomicDraftIds: number[] = [];
  const definitions = await extractAtomicDefinitions(node, usable);
  for (const def of definitions) {
    const defTitle = `What is ${def.term}?`;
    const defBody = applyNavigationScreen(def.definition) + relatedTopicsMarkdown(node);
    try {
      // An atomic term doc may already be published — revise it (by exact title)
      // rather than spawning a duplicate.
      const existingDef = await findLiveDocByTitle(defTitle);
      const [defDraft] = await db
        .insert(kbStagingDocsTable)
        .values({
          title: defTitle,
          content: defBody,
          category: node.root,
          homeRoot: node.root,
          node: node.slug,
          docType: "truth_draft",
          originType: "ai_synthesized",
          authorityRole,
          docClassTarget: "curated",
          ceiling: "conceptual",
          status: "needs_review",
          corroborationCount: usable.length,
          synthesisSources,
          sourceVideoTitle: sourcesSummary || null,
          updateKind: existingDef ? "update" : "new",
          targetLiveDocId: existingDef?.id ?? null,
          updateSummary: existingDef
            ? await summarizeRevision(node, existingDef.content, defBody, newSourceNames)
            : null,
          navMapVersion,
          aiSuggestedTaxonomy: {
            homeRoot: node.root,
            node: node.slug,
            docClass: "curated",
            ceiling: "conceptual",
          },
        })
        .returning({ id: kbStagingDocsTable.id });
      if (defDraft?.id) {
        atomicDraftIds.push(defDraft.id);
        _state.createdDrafts += 1;
      }
    } catch (err) {
      console.error(`[Synthesis] failed to create atomic definition "${def.term}" for node ${node.slug}:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Durable synthesis state (Part 2) ──────────────────────────────────────
  // Record what this run consumed so incremental runs can tell, later, whether
  // new material has landed for this node. We record the FULL set of currently
  // linked source ids (not just the top-N consolidated) as the "considered" set,
  // so any newly-linked source flags the node next time — and stamp the sources
  // that materially contributed as incorporated. Best-effort: a bookkeeping
  // failure must not fail the (already-created) draft.
  const linkedIds = linked.map((l) => l.source.id);
  const contributingIds = contributing.map((s) => s.id);
  try {
    if (contributingIds.length > 0) {
      await db
        .update(aiSourceDocumentsTable)
        .set({ incorporatedAt: new Date() })
        .where(inArray(aiSourceDocumentsTable.id, contributingIds));
    }
    await db
      .insert(kbNodeSynthesisStateTable)
      .values({
        node: node.slug,
        homeRoot: node.root,
        lastSynthesizedAt: new Date(),
        sourceDocIds: linkedIds,
        sourceCount: linkedIds.length,
        lastDraftId: draft?.id ?? null,
        lastError: null,
        lastAttemptAt: new Date(),
      })
      .onConflictDoUpdate({
        target: kbNodeSynthesisStateTable.node,
        set: {
          homeRoot: node.root,
          lastSynthesizedAt: new Date(),
          sourceDocIds: linkedIds,
          sourceCount: linkedIds.length,
          lastDraftId: draft?.id ?? null,
          lastError: null,
          lastAttemptAt: new Date(),
        },
      });
  } catch (err) {
    console.error(`[Synthesis] failed to persist synthesis state for node ${node.slug}:`, err instanceof Error ? err.message : err);
  }

  // ── Navigation-gap flags (Task #1776) ──────────────────────────────────────
  // ADVISORY only: detect member-performed actions in vocabulary apps across
  // this node's usable extracts and upsert durable per-(app, area) flags.
  // Best-effort — a flagging failure never affects the created drafts.
  try {
    await recordNavGapsForNode(node.slug, usable.map((e) => e.extract));
  } catch (err) {
    console.error(`[Synthesis] nav-gap flagging failed for node ${node.slug}:`, err instanceof Error ? err.message : err);
  }

  return { node: node.slug, draftId: draft?.id ?? null, atomicDraftIds, sourceCount: usable.length };
}

/**
 * Synthesize every node that has linked sources. Fire-and-forget; progress is
 * exposed via {@link getSynthesisState}. Returns the created draft ids so the
 * caller can kick off triage on exactly the new drafts.
 */
export async function synthesizeAllNodesBackground(): Promise<number[]> {
  return synthesizeNodesBackground(ALL_NODES.map((n) => n.slug));
}

/**
 * Synthesize a SPECIFIC set of nodes in the background (selective / incremental
 * runs, Part 2). Unknown slugs are dropped. Create-only, so re-synthesizing a
 * subset never touches other nodes' pending drafts. Fire-and-forget; progress is
 * exposed via {@link getSynthesisState}. Returns the created draft ids so the
 * caller can triage exactly the new drafts.
 */
export async function synthesizeNodesBackground(nodeSlugs: string[], scope = "nodes"): Promise<number[]> {
  if (_state.running) return [];
  const slugs = [...new Set(nodeSlugs)].filter((s) => isNode(s));
  _state = {
    running: true,
    totalNodes: slugs.length,
    processedNodes: 0,
    createdDrafts: 0,
    succeededCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failures: [],
    lengthStarvedCalls: 0,
    currentNode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    runId: null,
  };
  resetLengthStarvedCallCount();

  // Durable run report (synthesis hardening — mirrors kb_topic_index_runs). A
  // report-write failure must never block synthesis itself, so every write is
  // wrapped; but the run report is what makes outcomes survive a restart.
  const nodeOutcomes: SynthesisRunNodeOutcome[] = [];
  let runId: number | null = null;
  try {
    const [run] = await db
      .insert(kbSynthesisRunsTable)
      .values({ scope, totalNodes: slugs.length })
      .returning({ id: kbSynthesisRunsTable.id });
    runId = run?.id ?? null;
    _state.runId = runId;
  } catch (err) {
    console.error("[Synthesis] failed to create run report row:", err instanceof Error ? err.message : err);
  }

  const persistRun = async (final: boolean, fatalError?: string) => {
    if (runId === null) return;
    try {
      await db
        .update(kbSynthesisRunsTable)
        .set({
          processedNodes: _state.processedNodes,
          createdDrafts: _state.createdDrafts,
          succeededCount: _state.succeededCount,
          skippedCount: _state.skippedCount,
          failedCount: _state.failedCount,
          failures: _state.failures,
          lengthStarvedCalls: _state.lengthStarvedCalls,
          nodeOutcomes,
          ...(final ? { finishedAt: new Date(), error: fatalError ?? null } : {}),
        })
        .where(eq(kbSynthesisRunsTable.id, runId));
    } catch (err) {
      console.error("[Synthesis] failed to persist run report:", err instanceof Error ? err.message : err);
    }
  };

  const created: number[] = [];
  let fatalError: string | undefined;
  try {
    for (const slug of slugs) {
      _state.currentNode = slug;
      const nodeStartedAt = Date.now();
      try {
        const result = await synthesizeNode(slug);
        if (result.skippedReason) {
          _state.skippedCount += 1;
          nodeOutcomes.push({ node: slug, outcome: "skipped", skippedReason: result.skippedReason, durationMs: Date.now() - nodeStartedAt });
          // A skip is a valid terminal outcome — clear any stale failure state
          // so the node doesn't stay flagged as "affected" forever.
          await clearNodeFailureState(slug);
        } else {
          _state.succeededCount += 1;
          nodeOutcomes.push({
            node: slug,
            outcome: "created",
            draftId: result.draftId,
            atomicDraftIds: result.atomicDraftIds,
            sourceCount: result.sourceCount,
            durationMs: Date.now() - nodeStartedAt,
          });
        }
        if (result.draftId) created.push(result.draftId);
        created.push(...result.atomicDraftIds);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Synthesis] Failed to synthesize node ${slug}:`, message);
        _state.failedCount += 1;
        const sourceFailures = await getNodeExtractFailures(slug);
        _state.failures.push({ node: slug, error: message, ...(sourceFailures.length ? { sourceFailures } : {}) });
        nodeOutcomes.push({ node: slug, outcome: "failed", error: message, durationMs: Date.now() - nodeStartedAt });
        await recordNodeFailureState(slug, message);
      }
      _state.processedNodes += 1;
      _state.lengthStarvedCalls = getLengthStarvedCallCount();
      await persistRun(false);
    }
  } catch (err) {
    fatalError = err instanceof Error ? err.message : "Unknown error";
    _state.error = fatalError;
    console.error("[Synthesis] Run failed:", err);
  } finally {
    _state.running = false;
    _state.currentNode = null;
    _state.finishedAt = new Date().toISOString();
    _state.lengthStarvedCalls = getLengthStarvedCallCount();
    await persistRun(true, fatalError);
  }
  return created;
}

/** Latest durable synthesis run report (null when none has ever run). */
export async function getLastSynthesisRun(): Promise<KbSynthesisRun | null> {
  const rows = await db
    .select()
    .from(kbSynthesisRunsTable)
    .orderBy(desc(kbSynthesisRunsTable.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Nodes whose LAST synthesis attempt failed (lastError set) — these are picked
 * up automatically by the next incremental run. Surfaced in the status endpoint
 * so the UI can hint "N failed nodes pending retry".
 */
export async function getFailedNodesPendingRetry(): Promise<string[]> {
  try {
    const rows = await db
      .select({ node: kbNodeSynthesisStateTable.node })
      .from(kbNodeSynthesisStateTable)
      .where(sql`${kbNodeSynthesisStateTable.lastError} IS NOT NULL`);
    return rows.map((r) => r.node);
  } catch {
    return [];
  }
}

/** Durable extract failures for a node (what made its synthesis fail). */
async function getNodeExtractFailures(nodeSlug: string): Promise<Array<{ sourceDocId: number; error: string }>> {
  try {
    const rows = await db
      .select({ sourceDocId: kbSourceNodeExtractsTable.sourceDocId, error: kbSourceNodeExtractsTable.error })
      .from(kbSourceNodeExtractsTable)
      .where(and(eq(kbSourceNodeExtractsTable.node, nodeSlug), eq(kbSourceNodeExtractsTable.status, "failed")));
    return rows.map((r) => ({ sourceDocId: r.sourceDocId, error: r.error ?? "unknown" }));
  } catch {
    return [];
  }
}

// Record a node-level synthesis failure WITHOUT clobbering the durable success
// bookkeeping (sourceDocIds / lastSynthesizedAt / lastDraftId stay untouched on
// conflict) — the failure only sets lastError/lastAttemptAt, which is what makes
// the node "affected" again so the next incremental run retries it.
async function recordNodeFailureState(nodeSlug: string, message: string): Promise<void> {
  const node = ALL_NODES.find((n) => n.slug === nodeSlug);
  try {
    await db
      .insert(kbNodeSynthesisStateTable)
      .values({
        node: nodeSlug,
        homeRoot: node?.root ?? "process",
        // lastSynthesizedAt is NOT NULL (defaults now()); for a first-ever
        // failed attempt the default is cosmetic — lastError being set is what
        // marks the node affected/unhealed regardless.
        lastError: message.slice(0, 2000),
        lastAttemptAt: new Date(),
      })
      .onConflictDoUpdate({
        target: kbNodeSynthesisStateTable.node,
        set: { lastError: message.slice(0, 2000), lastAttemptAt: new Date() },
      });
  } catch (err) {
    console.error(`[Synthesis] failed to record failure state for node ${nodeSlug}:`, err instanceof Error ? err.message : err);
  }
}

// Clear stale failure state when a node terminates in a valid skip (update-only:
// a node with no state row needs none).
async function clearNodeFailureState(nodeSlug: string): Promise<void> {
  try {
    await db
      .update(kbNodeSynthesisStateTable)
      .set({ lastError: null, lastAttemptAt: new Date() })
      .where(eq(kbNodeSynthesisStateTable.node, nodeSlug));
  } catch (err) {
    console.error(`[Synthesis] failed to clear failure state for node ${nodeSlug}:`, err instanceof Error ? err.message : err);
  }
}

// ── Selective scope resolution (Part 2) ──────────────────────────────────────

export type SynthesisScope = "all" | "shelf" | "covered" | "incremental" | "nodes";

export interface ResolveScopeOpts {
  scope: SynthesisScope;
  root?: string | null;
  nodes?: string[];
  minSources?: number;
}

/** Minimum linked sources a node needs to count as "covered" for a bulk run. */
export const COVERED_MIN_SOURCES = 1;

/**
 * Resolve a requested synthesis scope into the concrete list of node slugs to
 * run. `synthesizeNode` itself skips nodes with no usable material, so this only
 * needs to produce the candidate set:
 *  - "all"         → every node.
 *  - "shelf"       → every node in `root`.
 *  - "covered"     → nodes with >= minSources (default COVERED_MIN_SOURCES) links.
 *  - "incremental" → nodes affected by newly-linked sources since last synthesis.
 *  - "nodes"       → the explicit `nodes` list (unknown slugs dropped downstream).
 */
export async function resolveSynthesisScope(opts: ResolveScopeOpts): Promise<string[]> {
  switch (opts.scope) {
    case "all":
      return ALL_NODES.map((n) => n.slug);
    case "shelf": {
      const root = (opts.root ?? "").trim();
      return ALL_NODES.filter((n) => n.root === root).map((n) => n.slug);
    }
    case "covered": {
      const min = Math.max(1, opts.minSources ?? COVERED_MIN_SOURCES);
      const counts = await getNodeLinkCounts();
      return ALL_NODES.filter((n) => (counts[n.slug] ?? 0) >= min).map((n) => n.slug);
    }
    case "incremental":
      return getAffectedNodes();
    case "nodes":
      return [...new Set(opts.nodes ?? [])].filter((s) => isNode(s));
    default:
      return [];
  }
}

// ── Incremental detection (Part 2) ───────────────────────────────────────────

/** The durable synthesis state keyed by node → recorded source-id set + failure. */
async function getSynthesisStateSets(): Promise<Map<string, { ids: Set<number>; lastError: string | null }>> {
  const rows = await db
    .select({
      node: kbNodeSynthesisStateTable.node,
      ids: kbNodeSynthesisStateTable.sourceDocIds,
      lastError: kbNodeSynthesisStateTable.lastError,
    })
    .from(kbNodeSynthesisStateTable);
  const map = new Map<string, { ids: Set<number>; lastError: string | null }>();
  for (const r of rows) map.set(r.node, { ids: new Set((r.ids ?? []) as number[]), lastError: r.lastError ?? null });
  return map;
}

/**
 * Nodes affected by newly-classified sources — i.e. a node is affected when it
 * has linked sources now AND either it was never synthesized, its current
 * linked-source set contains an id that was not present at the last synthesis,
 * OR its last synthesis attempt FAILED (lastError set — synthesis hardening:
 * incremental reruns self-heal failed nodes).
 * This is the engine behind real incremental runs: re-synthesize only these.
 */
export async function getAffectedNodes(): Promise<string[]> {
  const [current, states] = await Promise.all([getNodeCurrentSourceIds(), getSynthesisStateSets()]);
  const affected: string[] = [];
  for (const node of ALL_NODES) {
    const ids = current.get(node.slug) ?? [];
    if (ids.length === 0) continue;
    const prev = states.get(node.slug);
    if (!prev || prev.lastError !== null || ids.some((id) => !prev.ids.has(id))) affected.push(node.slug);
  }
  return affected;
}

// ── Depth-aware coverage view (Part 2) ───────────────────────────────────────

/** The published depth tier a node's root targets (exported for the coverage view). */
export function expectedDepthTier(node: TaxonomyNode): { docClassTarget: "overview" | "curated"; ceiling: string } {
  return depthTierFor(node);
}

/**
 * Minimum linked sources before a high-importance node's missing depth tier is
 * worth an advisory flag. Below this we have too little material to justify a
 * deeper doc, so staying quiet avoids noise.
 */
export const DEPTH_GAP_MIN_SOURCES = 3;

export interface NodeCoverage {
  slug: string;
  label: string;
  root: string;
  importance: NodeImportance;
  /** Sources currently linked to this node (topic index). */
  sourceCount: number;
  /** Of those, how many are brand new (never incorporated into any synthesis). */
  newSourceCount: number;
  /** Whether new/changed sources have landed since the last synthesis. */
  isAffected: boolean;
  /** Last synthesis time (ISO) or null if never synthesized. */
  lastSynthesizedAt: string | null;
  /** Source count fed into the last synthesis (null if never). */
  lastSynthesizedSourceCount: number | null;
  /** Citable live docs published at this node. */
  liveDocCount: number;
  /** Distinct citable doc_class tiers present among this node's live docs. */
  liveDocTiers: string[];
  /** The depth tier this node's root targets ('overview' | 'curated'). */
  expectedTier: "overview" | "curated";
  /** ADVISORY only — never a publish blocker. True when importance is high, the
   *  node has >= DEPTH_GAP_MIN_SOURCES sources, and the expected tier isn't published. */
  depthGap: boolean;
  depthGapReason: string | null;
}

/**
 * The depth-aware coverage view: per node, how much source material exists, how
 * new it is, whether a synthesis is stale, which citable live docs exist and at
 * what depth, plus a calibrated (importance + source-count gated) ADVISORY
 * depth-gap flag. Never gates publishing — it only informs the reviewer.
 */
export async function getSynthesisCoverage(): Promise<{
  nodes: NodeCoverage[];
  depthGapCount: number;
  affectedCount: number;
}> {
  const [counts, incorp, current, states, liveRows] = await Promise.all([
    getNodeLinkCounts(),
    getNodeSourceIncorporationCounts(),
    getNodeCurrentSourceIds(),
    getSynthesisStateSets(),
    db
      .select({
        node: aiLiveDocumentsTable.node,
        docClass: aiLiveDocumentsTable.docClass,
        cnt: sql<number>`count(*)::int`,
      })
      .from(aiLiveDocumentsTable)
      // Citable = curated/overview class, human-verified, member-facing.
      .where(sql`${aiLiveDocumentsTable.docClass} IN ('curated','overview')
        AND ${aiLiveDocumentsTable.lastVerified} IS NOT NULL
        AND ${aiLiveDocumentsTable.audience} <> 'admin'
        AND ${aiLiveDocumentsTable.node} IS NOT NULL`)
      .groupBy(aiLiveDocumentsTable.node, aiLiveDocumentsTable.docClass),
  ]);

  // Fold live-doc rows into per-node { count, tiers }.
  const liveByNode = new Map<string, { count: number; tiers: Set<string> }>();
  for (const r of liveRows) {
    if (!r.node) continue;
    const entry = liveByNode.get(r.node) ?? { count: 0, tiers: new Set<string>() };
    entry.count += r.cnt;
    if (r.docClass) entry.tiers.add(r.docClass);
    liveByNode.set(r.node, entry);
  }

  const stateRows = await db
    .select({
      node: kbNodeSynthesisStateTable.node,
      lastSynthesizedAt: kbNodeSynthesisStateTable.lastSynthesizedAt,
      sourceCount: kbNodeSynthesisStateTable.sourceCount,
    })
    .from(kbNodeSynthesisStateTable);
  const stateMeta = new Map(stateRows.map((r) => [r.node, r]));

  let depthGapCount = 0;
  let affectedCount = 0;
  const nodes: NodeCoverage[] = ALL_NODES.map((n) => {
    const sourceCount = counts[n.slug] ?? 0;
    const newSourceCount = incorp.get(n.slug)?.newCount ?? 0;
    const ids = current.get(n.slug) ?? [];
    const prev = states.get(n.slug);
    const isAffected = ids.length > 0 && (!prev || prev.lastError !== null || ids.some((id) => !prev.ids.has(id)));
    if (isAffected) affectedCount += 1;

    const live = liveByNode.get(n.slug);
    const liveDocCount = live?.count ?? 0;
    const liveDocTiers = live ? [...live.tiers] : [];
    const tier = depthTierFor(n);
    const importance = nodeImportance(n.slug);

    let depthGap = false;
    let depthGapReason: string | null = null;
    if (
      importance === "high" &&
      sourceCount >= DEPTH_GAP_MIN_SOURCES &&
      !liveDocTiers.includes(tier.docClassTarget)
    ) {
      depthGap = true;
      depthGapReason = liveDocCount === 0
        ? `High-demand topic with ${sourceCount} sources but no published doc yet.`
        : `High-demand topic with ${sourceCount} sources but no published ${tier.docClassTarget} doc yet.`;
      depthGapCount += 1;
    }

    const meta = stateMeta.get(n.slug);
    return {
      slug: n.slug,
      label: n.label,
      root: n.root,
      importance,
      sourceCount,
      newSourceCount,
      isAffected,
      lastSynthesizedAt: meta?.lastSynthesizedAt ? meta.lastSynthesizedAt.toISOString() : null,
      lastSynthesizedSourceCount: meta?.sourceCount ?? null,
      liveDocCount,
      liveDocTiers,
      expectedTier: tier.docClassTarget,
      depthGap,
      depthGapReason,
    };
  });

  return { nodes, depthGapCount, affectedCount };
}

/** Guard used by routes to validate a node slug param. */
export function isValidSynthesisNode(value: unknown): value is string {
  return isNode(value);
}
