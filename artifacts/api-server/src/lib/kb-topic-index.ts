import { db } from "@workspace/db";
import {
  aiSourceDocumentsTable,
  kbSourceNodeLinksTable,
  kbTopicIndexRunsTable,
  kbTopicIndexSourceStateTable,
  type TopicIndexRunFailure,
  type TopicIndexDuplicateGroup,
  type TopicIndexQualityCheck,
  type KbTopicIndexRun,
} from "@workspace/db/schema";
import { sql, eq, desc, inArray } from "drizzle-orm";
import {
  ALL_NODES,
  isNode,
  resolveHomeRoot,
  type TaxonomyNode,
} from "./kb-taxonomy.js";
import { contentWindows, mapWithConcurrency, fingerprintContent } from "./kb-source-windows.js";
import { resolveSourceContentForSynthesis } from "./kb-value-screener.js";

// Full-source read (Task #1561): classification walks the WHOLE document in
// overlapping windows instead of a single truncated prefix, so topics discussed
// past the old 9k cutoff still get linked.
const CLASSIFY_WINDOW_CHARS = 9000;
const CLASSIFY_WINDOW_OVERLAP = 1000;
// Per-window cap on how many nodes one window can assign (mirrors the "at most 4"
// prompt instruction). There is deliberately NO cap on the merged cross-window
// total — a long source must link to EVERY topic it materially covers.
const CLASSIFY_LINKS_PER_WINDOW = 4;
// How many source-document windows to classify concurrently. Bounds LLM fan-out
// now that every window (not just the first) is classified.
const CLASSIFY_WINDOW_CONCURRENCY = 4;
// How many SOURCE documents to classify concurrently within a run. Kept low:
// the first validation rerun at 3 sources × 4 windows tripped sustained 429s.
const CLASSIFY_SOURCE_CONCURRENCY = 2;

// Classifier model (Task #1794). gpt-5 is a reasoning model: its reasoning
// tokens ate the old 1200-token completion budget, the API returned 200 with
// EMPTY content + finish_reason=length, JSON.parse failed, and the source
// silently degraded to the lexical fallback (~34% of the corpus). The fix is a
// RAISED token ceiling (6000), plus explicit detection of the empty/truncated
// case as a FAILURE. We stay on gpt-5: the validation spot-check measured only
// ~61% node agreement for gpt-5-mini vs the stored gpt-5 links (below the ~85%
// bar), so mini would have silently re-shuffled two-thirds of the index.
const CLASSIFY_MODEL = "gpt-5";
const CLASSIFY_MAX_COMPLETION_TOKENS = 6000;
const CLASSIFY_TIMEOUT_MS = 120_000;
// Bounded retries per window before the source is considered LLM-failed.
const CLASSIFY_MAX_ATTEMPTS = 3;
const CLASSIFY_RETRY_BACKOFF_MS = [1000, 3000];
// Rate limits (429) get more attempts + much longer backoff — they are
// transient by definition and were the main source of lexical degradation in
// the first validation rerun.
const CLASSIFY_MAX_ATTEMPTS_429 = 5;
const CLASSIFY_RETRY_BACKOFF_429_MS = [5000, 15000, 30000, 60000];

// Node slug → home-root, derived from the taxonomy registry.
const NODE_ROOT_OF: ReadonlyMap<string, string> = new Map(ALL_NODES.map((n) => [n.slug, n.root]));

/**
 * Topic index — the source→taxonomy-node relevance layer behind the Synthesis
 * Engine (Task #1533).
 *
 * The AI Source Knowledge library is filed by source TYPE, not by topic, and
 * the repo has no semantic/vector search (retrieval is lexical tsvector). To let
 * synthesis gather ALL corpus material relevant to a taxonomy node, we run a
 * one-off classification pass: an LLM assigns each source document to the
 * node(s) it materially informs (with a 0..1 relevance + short rationale), and
 * those assignments are persisted in `kb_source_node_links`. A lexical
 * label/keyword scorer is the deterministic fallback when the model is
 * unavailable after retries, so the index is never empty — but a degraded
 * (lexical) source is recorded as such and self-heals on the next run.
 */

/** Per-source classification outcome (persisted in kb_topic_index_source_state). */
export type ClassifyOutcome = "llm" | "llm_none" | "lexical" | "failed" | "excluded";

export interface TopicIndexProgress {
  running: boolean;
  total: number;
  processed: number;
  linked: number;
  llmCount: number;
  llmNoneCount: number;
  lexicalCount: number;
  failedCount: number;
  excludedCount: number;
  runId: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

function emptyProgress(): TopicIndexProgress {
  return {
    running: false,
    total: 0,
    processed: 0,
    linked: 0,
    llmCount: 0,
    llmNoneCount: 0,
    lexicalCount: 0,
    failedCount: 0,
    excludedCount: 0,
    runId: null,
    startedAt: null,
    finishedAt: null,
    error: null,
  };
}

let _state: TopicIndexProgress = emptyProgress();

export function getTopicIndexState(): TopicIndexProgress {
  return { ..._state };
}

export function isTopicIndexRunning(): boolean {
  return _state.running;
}

export interface NodeLink {
  node: string;
  homeRoot: string;
  relevance: number;
  rationale: string | null;
  method: "llm" | "lexical";
}

type SourceDoc = typeof aiSourceDocumentsTable.$inferSelect;

// ── Lexical fallback ────────────────────────────────────────────────────────
//
// Deterministic label/keyword scorer. Each node contributes its label tokens
// (plus a few hand-curated synonyms for the ones whose label words are too
// generic to hit). We count occurrences in title+content and keep the strongest
// nodes. This is intentionally conservative — it exists so the index is never
// empty, not to replace the LLM's judgement.

const STOPWORDS = new Set([
  "and", "the", "of", "to", "for", "a", "an", "&", "system", "map", "review",
  "rounds", "selection", "assets", "setup", "access", "schedule", "help", "with",
]);

const NODE_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  "foundations": ["foundation", "overview", "getting started", "basics"],
  "network-and-offer": ["network", "offer", "affiliate", "clickbank", "media mavens", "vertical", "niche"],
  "creative-assets": ["creative", "ad", "ads", "image", "video creative", "vsl", "asset"],
  "compliance": ["compliance", "policy", "approval", "ad account", "ban", "flagged"],
  "tracking-and-setup": ["tracking", "pixel", "domain", "redirect", "landing page", "funnel"],
  "launch": ["launch", "go live", "publish", "live"],
  "testing": ["test", "testing", "round", "data", "kill"],
  "scaling": ["scale", "scaling", "budget", "duplicate", "roas"],
  "angles": ["angle", "angles", "hook", "pain point", "avatar"],
  "headlines-and-copy": ["headline", "copy", "copywriting", "ad copy", "primary text"],
  "creative-strategy": ["creative strategy", "concept", "format", "ugc"],
  "offer-strategy": ["offer", "payout", "epc", "commission"],
  "testing-methodology": ["methodology", "test", "significance", "cpa", "metric"],
  "scaling-strategy": ["scaling", "vertical scaling", "horizontal", "cbo", "abo"],
  "metrics-and-economics": ["metric", "economics", "roas", "cpa", "aov", "ltv", "margin", "profit"],
  "traffic-and-placements": ["traffic", "placement", "facebook", "meta", "tiktok", "google", "native"],
  "membership": ["membership", "account", "login", "profile", "subscription"],
  "billing-and-refunds": ["billing", "refund", "payment", "charge", "invoice", "cancel"],
  "coaching-access": ["coaching", "coach", "book", "session", "call", "schedule"],
  "support": ["support", "ticket", "escalation", "contact"],
  "getting-help": ["help", "faq", "how do i", "question"],
  "navigation": ["navigation", "portal", "menu", "where", "find"],
};

function nodeKeywords(node: TaxonomyNode): string[] {
  const fromLabel = node.label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return [...new Set([...fromLabel, ...(NODE_SYNONYMS[node.slug] ?? [])])];
}

const NODE_KEYWORDS: ReadonlyMap<string, string[]> = new Map(
  ALL_NODES.map((n) => [n.slug, nodeKeywords(n)]),
);

function classifyLexical(doc: SourceDoc): NodeLink[] {
  const hay = `${doc.title}\n${doc.content}`.toLowerCase();
  const scored: { node: string; hits: number }[] = [];
  for (const node of ALL_NODES) {
    const kws = NODE_KEYWORDS.get(node.slug) ?? [];
    let hits = 0;
    for (const kw of kws) {
      if (!kw) continue;
      // Count non-overlapping occurrences of the keyword phrase.
      const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      const m = hay.match(re);
      if (m) hits += m.length;
    }
    if (hits > 0) scored.push({ node: node.slug, hits });
  }
  if (scored.length === 0) return [];
  scored.sort((a, b) => b.hits - a.hits);
  const top = scored.slice(0, 4);
  const max = top[0].hits;
  return top.map((s) => ({
    node: s.node,
    homeRoot: NODE_ROOT_OF.get(s.node) ?? resolveHomeRoot(null),
    relevance: Math.min(1, Math.round((s.hits / max) * 100) / 100),
    rationale: "Keyword match (lexical fallback)",
    method: "lexical" as const,
  }));
}

// ── LLM classification ──────────────────────────────────────────────────────

function nodeCatalog(): string {
  const byRoot = new Map<string, TaxonomyNode[]>();
  for (const n of ALL_NODES) {
    const list = byRoot.get(n.root) ?? [];
    list.push(n);
    byRoot.set(n.root, list);
  }
  const lines: string[] = [];
  for (const [root, nodes] of byRoot) {
    lines.push(`ROOT "${root}":`);
    for (const n of nodes) lines.push(`  - ${n.slug}: ${n.label}`);
  }
  return lines.join("\n");
}

// De-dup a set of links on node, keeping the strongest relevance seen, sorted
// strongest-first. Used to fold the per-window classifications of one source into
// one link set. Deliberately UNCAPPED: the whole point of the full-source read is
// that a source links to every topic it materially covers.
export function mergeNodeLinks(links: NodeLink[]): NodeLink[] {
  const byNode = new Map<string, NodeLink>();
  for (const l of links) {
    const prev = byNode.get(l.node);
    if (!prev || l.relevance > prev.relevance) byNode.set(l.node, l);
  }
  return [...byNode.values()].sort((a, b) => b.relevance - a.relevance);
}

/**
 * Parse one chat-completions response into node links. Exported for tests.
 * Throws when the response is unusable (empty content — the reasoning-token
 * starvation mode — or unparseable JSON): an unusable response is a FAILURE,
 * never a "no nodes fit" verdict.
 */
export function parseClassifyResponse(json: {
  choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
}): NodeLink[] {
  const choice = json.choices?.[0];
  const raw = choice?.message?.content ?? "";
  if (raw.trim() === "") {
    throw new Error(
      `empty completion content (finish_reason=${choice?.finish_reason ?? "unknown"}) — likely token starvation`,
    );
  }
  let parsed: { nodes?: Array<{ node?: string; relevance?: number; rationale?: string }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `unparseable completion JSON (finish_reason=${choice?.finish_reason ?? "unknown"}): ${raw.slice(0, 120)}`,
    );
  }
  const out: NodeLink[] = [];
  for (const item of parsed.nodes ?? []) {
    const slug = typeof item.node === "string" ? item.node.trim() : "";
    if (!isNode(slug)) continue;
    const rel = typeof item.relevance === "number" && Number.isFinite(item.relevance)
      ? Math.max(0, Math.min(1, item.relevance))
      : 0.5;
    out.push({
      node: slug,
      homeRoot: NODE_ROOT_OF.get(slug) ?? resolveHomeRoot(null),
      relevance: Math.round(rel * 100) / 100,
      rationale: typeof item.rationale === "string" ? item.rationale.slice(0, 300) : null,
      method: "llm",
    });
  }
  // Per-window de-dup on node (keep the strongest relevance), capped per window.
  return mergeNodeLinks(out).slice(0, CLASSIFY_LINKS_PER_WINDOW);
}

// Classify ONE window of a source document. Returns up to 4 node links for the
// material present in this window. Throws on any failure (HTTP error, empty
// content, bad JSON) — the caller owns retry/fallback semantics.
async function classifyChunkWithLLM(
  doc: SourceDoc,
  chunk: string,
  model: string = CLASSIFY_MODEL,
): Promise<NodeLink[]> {
  const base = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!base || !key) throw new Error("LLM not configured (missing AI integration env)");

  const systemPrompt = `You classify a BTS (Build Test Scale) affiliate-marketing knowledge SOURCE document against a fixed taxonomy of topic nodes.
Return the node(s) this document MATERIALLY informs — i.e. it contains real, usable knowledge a truth-doc for that node could be built from. Ignore passing mentions.
Assign at most 4 nodes. Use ONLY node slugs from the catalog. relevance is 0..1 (how central the node is to this document).
Return STRICT JSON only: {"nodes":[{"node":"<slug>","relevance":<0..1>,"rationale":"<short why>"}]}. If nothing fits, return {"nodes":[]}.`;

  const catalog = nodeCatalog();
  const body = `TAXONOMY NODES:\n${catalog}\n\nSOURCE TITLE: ${doc.title}\nSOURCE TYPE: ${doc.sourceType}\n\nSOURCE CONTENT (excerpt):\n${chunk}`;

  const resp = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: body },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: CLASSIFY_MAX_COMPLETION_TOKENS,
    }),
    signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
  });

  if (!resp.ok) throw new Error(`topic-index classify failed: ${resp.status}`);
  const json = (await resp.json()) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
  };
  return parseClassifyResponse(json);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Classify one window with bounded retries + backoff. Throws only after all
// attempts are exhausted.
async function classifyChunkWithRetries(
  doc: SourceDoc,
  chunk: string,
  windowIndex: number,
  model?: string,
): Promise<NodeLink[]> {
  let lastErr: unknown;
  let attempt = 0;
  let maxAttempts = CLASSIFY_MAX_ATTEMPTS;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await classifyChunkWithLLM(doc, chunk, model);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const rateLimited = msg.includes("429");
      // A rate-limited window earns the longer 429 retry budget.
      if (rateLimited) maxAttempts = CLASSIFY_MAX_ATTEMPTS_429;
      console.error(
        `[TopicIndex] classify window ${windowIndex} attempt ${attempt}/${maxAttempts} failed for source ${doc.id}: ${msg}`,
      );
      if (attempt < maxAttempts) {
        const schedule = rateLimited ? CLASSIFY_RETRY_BACKOFF_429_MS : CLASSIFY_RETRY_BACKOFF_MS;
        await sleep(schedule[Math.min(attempt - 1, schedule.length - 1)]);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

interface LlmClassifyResult {
  links: NodeLink[];
  windowCount: number;
  failedWindows: number;
  /** First failure message when any window exhausted its retries. */
  error: string | null;
}

// Classify the WHOLE source by walking overlapping windows and merging every
// window's node links (dedupe, keep strongest relevance) so a source is linked
// to every topic it covers — not just those in the first 9k chars.
async function classifyWithLLM(doc: SourceDoc, model?: string): Promise<LlmClassifyResult> {
  const windows = contentWindows(doc.content, CLASSIFY_WINDOW_CHARS, CLASSIFY_WINDOW_OVERLAP);
  let failedWindows = 0;
  let firstError: string | null = null;
  const perWindow = await mapWithConcurrency(
    windows,
    CLASSIFY_WINDOW_CONCURRENCY,
    async (chunk, i) => {
      // Fault-tolerant per window: a failure on one window (after retries) must
      // not discard the successfully-classified windows.
      try {
        return await classifyChunkWithRetries(doc, chunk, i, model);
      } catch (err) {
        failedWindows += 1;
        if (!firstError) firstError = err instanceof Error ? err.message : String(err);
        return [] as NodeLink[];
      }
    },
  );
  return {
    links: mergeNodeLinks(perWindow.flat()),
    windowCount: windows.length,
    failedWindows,
    error: firstError,
  };
}

export interface ClassificationResult {
  links: NodeLink[];
  outcome: ClassifyOutcome;
  error: string | null;
}

/**
 * Classify a single source document into taxonomy node links with honest
 * outcome semantics (Task #1794):
 * - 'llm':      the LLM produced links (possibly from a subset of windows).
 * - 'llm_none': EVERY window classified cleanly and the LLM said no nodes fit.
 *               Respected — no lexical override, zero links persisted.
 * - 'lexical':  the LLM failed on ALL windows after retries; lexical fallback.
 * - 'failed':   the LLM failed AND the lexical scorer found nothing.
 * - 'excluded': screened duplicate — contributes nothing by design.
 */
export async function classifySourceDocument(doc: SourceDoc): Promise<ClassificationResult> {
  // Screened calls: classify against the kept-segments representation so
  // indexing doesn't spend tokens on chatter (falls back to raw when no valid
  // screening exists — see resolveSourceContentForSynthesis). A duplicate-
  // screened source contributes nothing: the original carries the content.
  const { content, excluded } = await resolveSourceContentForSynthesis(doc.id, doc.content);
  if (excluded) return { links: [], outcome: "excluded", error: null };
  const resolved: SourceDoc = { ...doc, content };

  const llm = await classifyWithLLM(resolved);
  if (llm.links.length > 0) {
    // Partial window failures don't degrade the outcome, but are surfaced.
    const partial = llm.failedWindows > 0
      ? `partial: ${llm.failedWindows}/${llm.windowCount} windows failed (${llm.error})`
      : null;
    return { links: llm.links, outcome: "llm", error: partial };
  }
  if (llm.failedWindows === 0) {
    // A deliberate LLM "no nodes fit" verdict — NOT overridden by lexical.
    return { links: [], outcome: "llm_none", error: null };
  }
  // LLM failed (some/all windows exhausted retries and nothing was linked).
  const reason = llm.error ?? "LLM classification failed";
  console.error(`[TopicIndex] LLM classify failed for source ${doc.id}, using lexical: ${reason}`);
  const lex = classifyLexical(resolved);
  return lex.length > 0
    ? { links: lex, outcome: "lexical", error: reason }
    : { links: [], outcome: "failed", error: reason };
}

/** Replace the persisted links for one source document with a freshly classified set. */
async function persistLinks(sourceDocId: number, links: NodeLink[]): Promise<number> {
  await db.transaction(async (tx) => {
    await tx.delete(kbSourceNodeLinksTable).where(eq(kbSourceNodeLinksTable.sourceDocId, sourceDocId));
    if (links.length > 0) {
      await tx.insert(kbSourceNodeLinksTable).values(
        links.map((l) => ({
          sourceDocId,
          homeRoot: l.homeRoot,
          node: l.node,
          relevance: l.relevance,
          method: l.method,
          rationale: l.rationale,
        })),
      );
    }
  });
  return links.length;
}

/** Upsert the durable per-source classification outcome. */
async function persistSourceOutcome(
  sourceDocId: number,
  outcome: ClassifyOutcome,
  error: string | null,
  runId: number | null,
): Promise<void> {
  await db
    .insert(kbTopicIndexSourceStateTable)
    .values({ sourceDocId, outcome, error, runId })
    .onConflictDoUpdate({
      target: kbTopicIndexSourceStateTable.sourceDocId,
      set: { outcome, error, runId, updatedAt: new Date() },
    });
}

// ── Re-run selection ────────────────────────────────────────────────────────

/**
 * Source-doc ids considered HEALTHY (skipped on a force=false run):
 * - any source with at least one LLM-derived link, or
 * - any source whose recorded outcome is a deliberate 'llm_none' or 'excluded'.
 * Everything else — pure-lexical link sets, zero-link sources without a
 * recorded LLM verdict, failed sources — is treated as unprocessed so a
 * force=false re-run self-heals the degraded portion of the index.
 */
async function getHealthySourceIds(): Promise<Set<number>> {
  const llmLinked = await db
    .selectDistinct({ id: kbSourceNodeLinksTable.sourceDocId })
    .from(kbSourceNodeLinksTable)
    .where(eq(kbSourceNodeLinksTable.method, "llm"));
  const deliberate = await db
    .select({ id: kbTopicIndexSourceStateTable.sourceDocId })
    .from(kbTopicIndexSourceStateTable)
    .where(inArray(kbTopicIndexSourceStateTable.outcome, ["llm_none", "excluded"]));
  return new Set<number>([...llmLinked.map((r) => r.id), ...deliberate.map((r) => r.id)]);
}

// ── Duplicate-source hygiene (flag only, never auto-delete) ─────────────────

/** Detect byte-identical source documents across the corpus. */
export function detectExactDuplicates(
  docs: Array<{ id: number; title: string; content: string }>,
): TopicIndexDuplicateGroup[] {
  const byHash = new Map<string, Array<{ id: number; title: string }>>();
  for (const d of docs) {
    const h = fingerprintContent(d.content);
    const list = byHash.get(h) ?? [];
    list.push({ id: d.id, title: d.title });
    byHash.set(h, list);
  }
  const groups: TopicIndexDuplicateGroup[] = [];
  for (const list of byHash.values()) {
    if (list.length < 2) continue;
    groups.push({ ids: list.map((x) => x.id).sort((a, b) => a - b), titles: list.map((x) => x.title) });
  }
  return groups.sort((a, b) => a.ids[0] - b.ids[0]);
}

// ── Run orchestration ───────────────────────────────────────────────────────

const RUN_FLUSH_EVERY = 5;
const MAX_RECORDED_FAILURES = 200;

async function flushRunRow(runId: number, failures: TopicIndexRunFailure[]): Promise<void> {
  await db
    .update(kbTopicIndexRunsTable)
    .set({
      total: _state.total,
      processed: _state.processed,
      llmCount: _state.llmCount,
      llmNoneCount: _state.llmNoneCount,
      lexicalCount: _state.lexicalCount,
      failedCount: _state.failedCount,
      excludedCount: _state.excludedCount,
      linkedCount: _state.linked,
      failures: failures.slice(0, MAX_RECORDED_FAILURES),
    })
    .where(eq(kbTopicIndexRunsTable.id, runId));
}

/**
 * Build (or refresh) the topic index across the source corpus. When `force` is
 * false, sources that already have healthy LLM links (or a deliberate LLM
 * "no nodes fit" / excluded verdict) are skipped; degraded sources (pure-lexical
 * or zero links without a verdict) are automatically re-attempted. `force=true`
 * re-classifies everything. Fire-and-forget; live progress via
 * {@link getTopicIndexState}, durable report in kb_topic_index_runs.
 */
export async function buildTopicIndexBackground(opts: { force?: boolean } = {}): Promise<void> {
  if (_state.running) return;
  const force = opts.force === true;
  _state = { ...emptyProgress(), running: true, startedAt: new Date().toISOString() };

  let runId: number | null = null;
  const failures: TopicIndexRunFailure[] = [];
  try {
    const [runRow] = await db
      .insert(kbTopicIndexRunsTable)
      .values({ force })
      .returning({ id: kbTopicIndexRunsTable.id });
    runId = runRow.id;
    _state.runId = runId;

    // Which source docs to (re)classify.
    const allDocs = await db.select().from(aiSourceDocumentsTable);
    let docs: SourceDoc[];
    if (force) {
      docs = allDocs;
    } else {
      const healthy = await getHealthySourceIds();
      docs = allDocs.filter((d) => !healthy.has(d.id));
    }

    _state.total = docs.length;

    // Duplicate hygiene: flag byte-identical sources up front (operators clean
    // these up manually; the run never auto-deletes).
    const duplicateFlags = detectExactDuplicates(allDocs);
    await db
      .update(kbTopicIndexRunsTable)
      .set({ total: docs.length, duplicateFlags })
      .where(eq(kbTopicIndexRunsTable.id, runId));

    let sinceFlush = 0;
    await mapWithConcurrency(docs, CLASSIFY_SOURCE_CONCURRENCY, async (doc) => {
      try {
        const result = await classifySourceDocument(doc);
        _state.linked += await persistLinks(doc.id, result.links);
        await persistSourceOutcome(doc.id, result.outcome, result.error, runId);
        switch (result.outcome) {
          case "llm": _state.llmCount += 1; break;
          case "llm_none": _state.llmNoneCount += 1; break;
          case "lexical": _state.lexicalCount += 1; break;
          case "failed": _state.failedCount += 1; break;
          case "excluded": _state.excludedCount += 1; break;
        }
        if (result.error && result.outcome !== "llm") {
          failures.push({ sourceDocId: doc.id, title: doc.title, reason: result.error });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        _state.failedCount += 1;
        failures.push({ sourceDocId: doc.id, title: doc.title, reason });
        console.error(`[TopicIndex] Failed to classify source ${doc.id}:`, reason);
        await persistSourceOutcome(doc.id, "failed", reason, runId).catch(() => {});
      }
      _state.processed += 1;
      sinceFlush += 1;
      if (sinceFlush >= RUN_FLUSH_EVERY) {
        sinceFlush = 0;
        await flushRunRow(runId!, failures).catch(() => {});
      }
    });
  } catch (err) {
    _state.error = err instanceof Error ? err.message : "Unknown error";
    console.error("[TopicIndex] Build failed:", err);
  } finally {
    _state.running = false;
    _state.finishedAt = new Date().toISOString();
    if (runId !== null) {
      await flushRunRow(runId, failures).catch(() => {});
      await db
        .update(kbTopicIndexRunsTable)
        .set({ finishedAt: new Date(), error: _state.error })
        .where(eq(kbTopicIndexRunsTable.id, runId))
        .catch(() => {});
    }
  }
}

/** The most recent run report (durable — survives restarts). */
export async function getLastTopicIndexRun(): Promise<KbTopicIndexRun | null> {
  const [row] = await db
    .select()
    .from(kbTopicIndexRunsTable)
    .orderBy(desc(kbTopicIndexRunsTable.startedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Corpus health summary for the status endpoint: how many sources currently
 * carry only lexical links (degraded), zero links, or healthy LLM links.
 */
export async function getTopicIndexHealth(): Promise<{
  totalSources: number;
  llmSources: number;
  pureLexicalSources: number;
  zeroLinkSources: number;
  llmNoneSources: number;
}> {
  const result = await db.execute<{
    total_sources: number;
    llm_sources: number;
    pure_lexical_sources: number;
    zero_link_sources: number;
    llm_none_sources: number;
  }>(sql`
    WITH per_source AS (
      SELECT d.id,
        COUNT(l.id) AS link_count,
        COUNT(l.id) FILTER (WHERE l.method = 'llm') AS llm_count,
        s.outcome
      FROM ai_source_documents d
      LEFT JOIN kb_source_node_links l ON l.source_doc_id = d.id
      LEFT JOIN kb_topic_index_source_state s ON s.source_doc_id = d.id
      GROUP BY d.id, s.outcome
    )
    SELECT
      COUNT(*)::int AS total_sources,
      COUNT(*) FILTER (WHERE llm_count > 0)::int AS llm_sources,
      COUNT(*) FILTER (WHERE link_count > 0 AND llm_count = 0)::int AS pure_lexical_sources,
      COUNT(*) FILTER (WHERE link_count = 0)::int AS zero_link_sources,
      COUNT(*) FILTER (WHERE outcome = 'llm_none')::int AS llm_none_sources
    FROM per_source
  `);
  const row = result.rows[0];
  return {
    totalSources: row?.total_sources ?? 0,
    llmSources: row?.llm_sources ?? 0,
    pureLexicalSources: row?.pure_lexical_sources ?? 0,
    zeroLinkSources: row?.zero_link_sources ?? 0,
    llmNoneSources: row?.llm_none_sources ?? 0,
  };
}

// ── Model-quality spot-check (Task #1794 step 7) ────────────────────────────

let _qualityCheckRunning = false;
export function isQualityCheckRunning(): boolean {
  return _qualityCheckRunning;
}

/**
 * Re-classify a sample of sources that already have healthy LLM (gpt-5) links
 * using the CURRENT classifier model, WITHOUT persisting, and compare node
 * selections + relevance against the stored links. The report is attached to
 * the most recent run row. Decision rule lives with the operator: agreement
 * below ~85% or systematically weaker links ⇒ switch back to gpt-5.
 */
export async function runTopicIndexQualitySpotCheck(sampleSize = 18): Promise<TopicIndexQualityCheck> {
  if (_qualityCheckRunning) throw new Error("Quality spot-check already running");
  _qualityCheckRunning = true;
  try {
    // Sources whose current links are ALL llm-derived (healthy baseline).
    const sampled = await db.execute<{ source_doc_id: number }>(sql`
      SELECT source_doc_id
      FROM kb_source_node_links
      GROUP BY source_doc_id
      HAVING COUNT(*) FILTER (WHERE method <> 'llm') = 0 AND COUNT(*) > 0
      ORDER BY random()
      LIMIT ${sampleSize}
    `);
    const ids = sampled.rows.map((r) => r.source_doc_id);
    const docs = ids.length > 0
      ? await db.select().from(aiSourceDocumentsTable).where(inArray(aiSourceDocumentsTable.id, ids))
      : [];

    const perSource: TopicIndexQualityCheck["perSource"] = [];
    await mapWithConcurrency(docs, 2, async (doc) => {
      const stored = await db
        .select()
        .from(kbSourceNodeLinksTable)
        .where(eq(kbSourceNodeLinksTable.sourceDocId, doc.id));
      const storedNodes = stored.map((l) => l.node).sort();
      try {
        const { content, excluded } = await resolveSourceContentForSynthesis(doc.id, doc.content);
        if (excluded) return;
        const llm = await classifyWithLLM({ ...doc, content });
        if (llm.failedWindows > 0 && llm.links.length === 0) {
          throw new Error(llm.error ?? "classification failed");
        }
        const newNodes = llm.links.map((l) => l.node).sort();
        const storedSet = new Set(storedNodes);
        const newSet = new Set(newNodes);
        const inter = storedNodes.filter((n) => newSet.has(n));
        const union = new Set([...storedNodes, ...newNodes]);
        const agreement = union.size === 0 ? 1 : inter.length / union.size;
        let relevanceDelta: number | null = null;
        if (inter.length > 0) {
          const storedRel = new Map(stored.map((l) => [l.node, l.relevance]));
          const newRel = new Map(llm.links.map((l) => [l.node, l.relevance]));
          relevanceDelta =
            inter.reduce((s, n) => s + ((newRel.get(n) ?? 0) - (storedRel.get(n) ?? 0)), 0) / inter.length;
        }
        perSource.push({ sourceDocId: doc.id, title: doc.title, storedNodes, newNodes, agreement, relevanceDelta });
      } catch (err) {
        perSource.push({
          sourceDocId: doc.id,
          title: doc.title,
          storedNodes,
          newNodes: [],
          agreement: 0,
          relevanceDelta: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    const ok = perSource.filter((p) => !p.error);
    const report: TopicIndexQualityCheck = {
      ranAt: new Date().toISOString(),
      model: CLASSIFY_MODEL,
      sampleSize: perSource.length,
      nodeAgreement: ok.length > 0 ? ok.reduce((s, p) => s + p.agreement, 0) / ok.length : 0,
      meanRelevanceDelta: (() => {
        const deltas = ok.map((p) => p.relevanceDelta).filter((d): d is number => d !== null);
        return deltas.length > 0 ? deltas.reduce((s, d) => s + d, 0) / deltas.length : 0;
      })(),
      perSource: perSource.sort((a, b) => a.sourceDocId - b.sourceDocId),
    };

    const lastRun = await getLastTopicIndexRun();
    if (lastRun) {
      await db
        .update(kbTopicIndexRunsTable)
        .set({ qualityCheck: report })
        .where(eq(kbTopicIndexRunsTable.id, lastRun.id));
    }
    return report;
  } finally {
    _qualityCheckRunning = false;
  }
}

export interface NodeSource {
  link: typeof kbSourceNodeLinksTable.$inferSelect;
  source: SourceDoc;
}

/** All source documents linked to a node, strongest relevance first. */
export async function getNodeSourceLinks(node: string): Promise<NodeSource[]> {
  const rows = await db
    .select({ link: kbSourceNodeLinksTable, source: aiSourceDocumentsTable })
    .from(kbSourceNodeLinksTable)
    .innerJoin(aiSourceDocumentsTable, eq(kbSourceNodeLinksTable.sourceDocId, aiSourceDocumentsTable.id))
    .where(eq(kbSourceNodeLinksTable.node, node))
    .orderBy(sql`${kbSourceNodeLinksTable.relevance} DESC`);
  return rows.map((r) => ({ link: r.link, source: r.source }));
}

/** Per-node link counts (source docs classified into each node). */
export async function getNodeLinkCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ node: kbSourceNodeLinksTable.node, cnt: sql<number>`count(*)::int` })
    .from(kbSourceNodeLinksTable)
    .groupBy(kbSourceNodeLinksTable.node);
  return rows.reduce((acc, r) => ({ ...acc, [r.node]: r.cnt }), {} as Record<string, number>);
}

/**
 * The source-doc ids currently linked to each node, keyed by node slug. This is
 * the live "what material belongs to this node right now" set the Synthesis
 * Engine (Part 2) compares against the durable per-node synthesis state to
 * detect nodes affected by newly-classified sources.
 */
export async function getNodeCurrentSourceIds(): Promise<Map<string, number[]>> {
  const rows = await db
    .select({
      node: kbSourceNodeLinksTable.node,
      ids: sql<number[]>`array_agg(${kbSourceNodeLinksTable.sourceDocId})`,
    })
    .from(kbSourceNodeLinksTable)
    .groupBy(kbSourceNodeLinksTable.node);
  const map = new Map<string, number[]>();
  for (const r of rows) map.set(r.node, (r.ids ?? []).filter((id): id is number => typeof id === "number"));
  return map;
}

/**
 * Per-node counts of linked sources split by whether they have ever been folded
 * into a synthesis (`ai_source_documents.incorporated_at`). `newCount` is the
 * number of linked sources that are brand new (never incorporated anywhere).
 */
export async function getNodeSourceIncorporationCounts(): Promise<
  Map<string, { total: number; newCount: number }>
> {
  const rows = await db
    .select({
      node: kbSourceNodeLinksTable.node,
      total: sql<number>`count(*)::int`,
      newCount: sql<number>`count(*) FILTER (WHERE ${aiSourceDocumentsTable.incorporatedAt} IS NULL)::int`,
    })
    .from(kbSourceNodeLinksTable)
    .innerJoin(aiSourceDocumentsTable, eq(kbSourceNodeLinksTable.sourceDocId, aiSourceDocumentsTable.id))
    .groupBy(kbSourceNodeLinksTable.node);
  const map = new Map<string, { total: number; newCount: number }>();
  for (const r of rows) map.set(r.node, { total: r.total, newCount: r.newCount });
  return map;
}
