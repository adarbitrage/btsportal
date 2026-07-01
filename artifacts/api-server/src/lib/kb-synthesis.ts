import { db } from "@workspace/db";
import {
  kbStagingDocsTable,
  aiSourceDocumentsTable,
  aiLiveDocumentsTable,
  kbNodeSynthesisStateTable,
} from "@workspace/db/schema";
import { sql, inArray, eq, desc } from "drizzle-orm";
import {
  ALL_NODES,
  isNode,
  AUTHORITY_ROLES,
  nodeImportance,
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

// How many sources (strongest relevance first) we consolidate per node. Bounds
// the LLM context and keeps the job responsive on large nodes.
const MAX_SOURCES_PER_NODE = 12;
// Per-source node-relevant extract length (map phase output cap).
const MAP_EXTRACT_CHARS = 1200;
// Per-source content fed into the map phase.
const MAP_INPUT_CHARS = 6000;

export interface SynthesisProgress {
  running: boolean;
  totalNodes: number;
  processedNodes: number;
  createdDrafts: number;
  currentNode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

let _state: SynthesisProgress = {
  running: false,
  totalNodes: 0,
  processedNodes: 0,
  createdDrafts: 0,
  currentNode: null,
  startedAt: null,
  finishedAt: null,
  error: null,
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

const AUTHORITY_RANK: Readonly<Record<AuthorityRole, number>> = {
  strategic_coach: 3,
  curriculum: 2,
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

async function callLLM(system: string, user: string, maxTokens: number, jsonMode = false): Promise<string> {
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
    signal: AbortSignal.timeout(90000),
  });
  if (!resp.ok) throw new Error(`AI synthesis call failed: ${resp.status}`);
  const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

// Map phase: pull the node-relevant knowledge out of one source, discarding the
// rest. Keeps the reduce phase focused and within budget.
async function extractForNode(node: TaxonomyNode, source: SourceDoc): Promise<string> {
  const system = `You extract ONLY the material relevant to a specific topic from a BTS (Build Test Scale) affiliate-marketing source document.
TOPIC: "${node.label}".
Return a tight bullet list of the concrete, usable facts / steps / guidance this source gives about that topic. Omit anything off-topic, pleasantries and filler. If the source says nothing usable about the topic, return exactly "NONE".
No preamble. Under ${MAP_EXTRACT_CHARS} characters.`;
  const user = `SOURCE TITLE: ${source.title}\n\nSOURCE CONTENT:\n${source.content.substring(0, MAP_INPUT_CHARS)}`;
  try {
    const out = await callLLM(system, user, 700);
    return out;
  } catch (err) {
    console.error(`[Synthesis] map extract failed for source ${source.id}:`, err instanceof Error ? err.message : err);
    // Fall back to a raw truncated excerpt so the source still contributes.
    return source.content.substring(0, MAP_EXTRACT_CHARS);
  }
}

// Reduce phase: consolidate the per-source extracts into ONE layered truth doc.
async function consolidate(
  node: TaxonomyNode,
  tier: { docClassTarget: string; ceiling: string },
  extracts: { source: SourceDoc; relevance: number; extract: string }[],
): Promise<{ title: string; body: string }> {
  const depthGuidance = tier.docClassTarget === "overview"
    ? `Write an OVERVIEW: a clear checklist/roadmap for this lifecycle stage — what to do, in order, with the key decision points. Operational depth.`
    : `Write a CURATED explainer: lead with a short plain-language summary, then go deep on the concept with the reasoning, examples and nuances the sources support. Conceptual depth.`;

  const numbered = extracts
    .map((e, i) => `[SOURCE ${i + 1}] (${e.source.sourceType}, authority=${e.source.authorityRole ?? "internal"})\n${e.extract}`)
    .join("\n\n");

  const relatedNodes = ALL_NODES.filter((n) => n.root === node.root && n.slug !== node.slug)
    .map((n) => n.label)
    .join(", ");

  const system = `You are the BTS (Build Test Scale) knowledge synthesist. You consolidate knowledge that appears across MANY source documents into ONE authoritative truth document for a single topic node.
TOPIC NODE: "${node.label}" (root: ${node.root}).
${depthGuidance}
RULES:
- Consolidate — merge overlapping points, resolve small redundancies, present the collective best understanding. Do NOT just concatenate the sources.
- Where sources genuinely disagree, note the disagreement plainly rather than picking silently.
- Layer the doc: a summary/orientation first, then the detail.
- Add brief cross-links in prose to closely related topics where natural (related here: ${relatedNodes || "n/a"}).
- BRAND RULES: say "Build Test Scale" / "BTS" (never "TCE" or "Cherrington"); no coach surnames; support email is support@buildtestscale.com.
- Output MARKDOWN only. First line MUST be a single "# Title" heading, then the body. No preamble, no meta commentary about sources.`;

  const user = `Consolidate the following ${extracts.length} source extract(s) into one truth document for "${node.label}".\n\n${numbered}`;

  const out = await callLLM(system, user, 4000);
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

// ── Depth-ladder cross-linking ────────────────────────────────────────────────
//
// Deterministic (non-LLM) cross-link contract so the depth ladder is always
// wired both ways: an OVERVIEW (process stage) points down to the CONCEPT deep
// dives, and a CURATED concept points up to the process stages where it applies.
// Appended verbatim to every synthesized body so the structure never depends on
// the model remembering to add prose links.
function relatedTopicsMarkdown(node: TaxonomyNode): string {
  const bullets = (root: TaxonomyNode["root"]) =>
    ALL_NODES.filter((n) => n.root === root && n.slug !== node.slug).map((n) => `- ${n.label}`);

  const sections: string[] = [];
  if (node.root === "process") {
    const concepts = bullets("concepts");
    if (concepts.length) sections.push(`**Go deeper — the skills behind this stage:**\n${concepts.join("\n")}`);
    const stages = bullets("process");
    if (stages.length) sections.push(`**Other stages:**\n${stages.join("\n")}`);
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

async function extractAtomicDefinitions(
  node: TaxonomyNode,
  extracts: { source: SourceDoc; extract: string }[],
): Promise<AtomicDefinition[]> {
  const system = `You review consolidated BTS (Build Test Scale) affiliate-marketing material for ONE topic and identify KEY TERMS that deserve their own short standalone definition document (like an entry answering "What is an angle?").
Only include a term when the material actually DEFINES or explains it AND it is a reusable concept a member would look up on its own — never a passing mention. Return AT MOST ${MAX_ATOMIC_DEFS_PER_NODE}.
Return ONLY JSON: {"definitions":[{"term":"<the term>","definition":"<2-4 sentence plain-language definition in member vocabulary>"}]}. Return {"definitions":[]} if none qualify.
BRAND RULES: say "Build Test Scale" / "BTS" (never "TCE" or "Cherrington"); no coach surnames.`;
  const user = `TOPIC NODE: "${node.label}" (root: ${node.root}).\n\nMATERIAL:\n${extracts
    .map((e, i) => `[SOURCE ${i + 1}]\n${e.extract}`)
    .join("\n\n")}`;
  try {
    const raw = await callLLM(system, user, 1500, true);
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
    const out = await callLLM(system, user, 700);
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

  const top = linked.slice(0, MAX_SOURCES_PER_NODE);
  const tier = depthTierFor(node);

  // Map: extract node-relevant material per source (concurrently).
  const extracts = await Promise.all(
    top.map(async (l) => ({
      source: l.source,
      relevance: l.link.relevance,
      extract: await extractForNode(node, l.source),
    })),
  );

  // Drop sources that had nothing usable for this node.
  const usable = extracts.filter((e) => e.extract && e.extract.trim().toUpperCase() !== "NONE");
  if (usable.length === 0) {
    return { node: node.slug, draftId: null, atomicDraftIds: [], sourceCount: 0, skippedReason: "no usable material after extraction" };
  }

  // Reduce: consolidate into one layered draft, then append the deterministic
  // depth-ladder cross-link section so overview↔concept docs are always wired.
  const { title, body: consolidated } = await consolidate(node, tier, usable);
  const body = consolidated + relatedTopicsMarkdown(node);

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
    const defBody = def.definition + relatedTopicsMarkdown(node);
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
      })
      .onConflictDoUpdate({
        target: kbNodeSynthesisStateTable.node,
        set: {
          homeRoot: node.root,
          lastSynthesizedAt: new Date(),
          sourceDocIds: linkedIds,
          sourceCount: linkedIds.length,
          lastDraftId: draft?.id ?? null,
        },
      });
  } catch (err) {
    console.error(`[Synthesis] failed to persist synthesis state for node ${node.slug}:`, err instanceof Error ? err.message : err);
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
export async function synthesizeNodesBackground(nodeSlugs: string[]): Promise<number[]> {
  if (_state.running) return [];
  const slugs = [...new Set(nodeSlugs)].filter((s) => isNode(s));
  _state = {
    running: true,
    totalNodes: slugs.length,
    processedNodes: 0,
    createdDrafts: 0,
    currentNode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };

  const created: number[] = [];
  try {
    for (const slug of slugs) {
      _state.currentNode = slug;
      try {
        const result = await synthesizeNode(slug);
        if (result.draftId) created.push(result.draftId);
        created.push(...result.atomicDraftIds);
      } catch (err) {
        console.error(`[Synthesis] Failed to synthesize node ${slug}:`, err instanceof Error ? err.message : err);
      }
      _state.processedNodes += 1;
    }
  } catch (err) {
    _state.error = err instanceof Error ? err.message : "Unknown error";
    console.error("[Synthesis] Run failed:", err);
  } finally {
    _state.running = false;
    _state.currentNode = null;
    _state.finishedAt = new Date().toISOString();
  }
  return created;
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

/** The durable synthesis state keyed by node → recorded source-id set. */
async function getSynthesisStateSets(): Promise<Map<string, Set<number>>> {
  const rows = await db
    .select({ node: kbNodeSynthesisStateTable.node, ids: kbNodeSynthesisStateTable.sourceDocIds })
    .from(kbNodeSynthesisStateTable);
  const map = new Map<string, Set<number>>();
  for (const r of rows) map.set(r.node, new Set((r.ids ?? []) as number[]));
  return map;
}

/**
 * Nodes affected by newly-classified sources — i.e. a node is affected when it
 * has linked sources now AND either it was never synthesized, or its current
 * linked-source set contains an id that was not present at the last synthesis.
 * This is the engine behind real incremental runs: re-synthesize only these.
 */
export async function getAffectedNodes(): Promise<string[]> {
  const [current, states] = await Promise.all([getNodeCurrentSourceIds(), getSynthesisStateSets()]);
  const affected: string[] = [];
  for (const node of ALL_NODES) {
    const ids = current.get(node.slug) ?? [];
    if (ids.length === 0) continue;
    const prev = states.get(node.slug);
    if (!prev || ids.some((id) => !prev.has(id))) affected.push(node.slug);
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
    const isAffected = ids.length > 0 && (!prev || ids.some((id) => !prev.has(id)));
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
