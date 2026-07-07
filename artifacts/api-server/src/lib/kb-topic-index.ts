import { db } from "@workspace/db";
import { aiSourceDocumentsTable, kbSourceNodeLinksTable } from "@workspace/db/schema";
import { sql, eq } from "drizzle-orm";
import {
  ALL_NODES,
  isNode,
  resolveHomeRoot,
  type TaxonomyNode,
} from "./kb-taxonomy.js";
import { contentWindows, mapWithConcurrency } from "./kb-source-windows.js";
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
 * unavailable or returns nothing usable, so the index is never empty.
 */

export interface TopicIndexProgress {
  running: boolean;
  total: number;
  processed: number;
  linked: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

let _state: TopicIndexProgress = {
  running: false,
  total: 0,
  processed: 0,
  linked: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

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

// Classify ONE window of a source document. Returns up to 4 node links for the
// material present in this window (the per-call cap is unchanged — coverage
// across the whole document comes from classifying every window and merging).
async function classifyChunkWithLLM(doc: SourceDoc, chunk: string): Promise<NodeLink[]> {
  const base = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!base || !key) return [];

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
      model: "gpt-5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: body },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) throw new Error(`topic-index classify failed: ${resp.status}`);
  const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = json.choices?.[0]?.message?.content ?? "";
  let parsed: { nodes?: Array<{ node?: string; relevance?: number; rationale?: string }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
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

// Classify the WHOLE source by walking overlapping windows and merging every
// window's node links (dedupe, keep strongest relevance) so a source is linked
// to every topic it covers — not just those in the first 9k chars.
async function classifyWithLLM(doc: SourceDoc): Promise<NodeLink[]> {
  const base = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!base || !key) return [];

  const windows = contentWindows(doc.content, CLASSIFY_WINDOW_CHARS, CLASSIFY_WINDOW_OVERLAP);
  const perWindow = await mapWithConcurrency(
    windows,
    CLASSIFY_WINDOW_CONCURRENCY,
    async (chunk, i) => {
      // Fault-tolerant per window: a transient failure on one window must not
      // discard the successfully-classified windows (which would collapse the
      // whole source to the lexical fallback and lose coverage).
      try {
        return await classifyChunkWithLLM(doc, chunk);
      } catch (err) {
        console.error(`[TopicIndex] classify window ${i} failed for source ${doc.id}:`, err instanceof Error ? err.message : err);
        return [] as NodeLink[];
      }
    },
  );
  return mergeNodeLinks(perWindow.flat());
}

/**
 * Classify a single source document into taxonomy node links. LLM first, with a
 * lexical fallback when the model is unavailable / returns nothing.
 */
export async function classifySourceDocument(doc: SourceDoc): Promise<NodeLink[]> {
  // Screened calls: classify against the kept-segments representation so
  // indexing doesn't spend tokens on chatter (falls back to raw when no valid
  // screening exists — see resolveSourceContentForSynthesis).
  const { content } = await resolveSourceContentForSynthesis(doc.id, doc.content);
  const resolved: SourceDoc = { ...doc, content };
  try {
    const llm = await classifyWithLLM(resolved);
    if (llm.length > 0) return llm;
  } catch (err) {
    console.error(`[TopicIndex] LLM classify failed for source ${doc.id}, using lexical:`, err instanceof Error ? err.message : err);
  }
  return classifyLexical(resolved);
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

/**
 * Build (or refresh) the topic index across the source corpus. When `force` is
 * false only source docs that have no links yet are (re)classified — cheap to
 * run incrementally after new sources land. Fire-and-forget; progress is exposed
 * via {@link getTopicIndexState}.
 */
export async function buildTopicIndexBackground(opts: { force?: boolean } = {}): Promise<void> {
  if (_state.running) return;
  _state = {
    running: true,
    total: 0,
    processed: 0,
    linked: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };

  try {
    const force = opts.force === true;

    // Which source docs to (re)classify.
    let docs: SourceDoc[];
    if (force) {
      docs = await db.select().from(aiSourceDocumentsTable);
    } else {
      const linkedRows = await db
        .selectDistinct({ id: kbSourceNodeLinksTable.sourceDocId })
        .from(kbSourceNodeLinksTable);
      const linkedIds = linkedRows.map((r) => r.id);
      docs = linkedIds.length > 0
        ? await db.select().from(aiSourceDocumentsTable).where(sql`${aiSourceDocumentsTable.id} <> ALL(${sql`ARRAY[${sql.join(linkedIds.map((id) => sql`${id}`), sql`, `)}]::int[]`})`)
        : await db.select().from(aiSourceDocumentsTable);
    }

    _state.total = docs.length;

    for (const doc of docs) {
      try {
        const links = await classifySourceDocument(doc);
        _state.linked += await persistLinks(doc.id, links);
      } catch (err) {
        console.error(`[TopicIndex] Failed to classify source ${doc.id}:`, err instanceof Error ? err.message : err);
      }
      _state.processed += 1;
    }
  } catch (err) {
    _state.error = err instanceof Error ? err.message : "Unknown error";
    console.error("[TopicIndex] Build failed:", err);
  } finally {
    _state.running = false;
    _state.finishedAt = new Date().toISOString();
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
