/**
 * AI-assistant domain taxonomy — the data-driven registry (Task #1 foundation).
 *
 * This is the SINGLE source of truth for the controlled vocabularies the
 * assistant's knowledge base is organised by. It is deliberately a declarative
 * data module (not Postgres enums and not TS union literals baked into the
 * schema): the DB columns (`home_root`, `node`, `tags`, `doc_class`, source
 * `disposition` / `authority_role`) are plain `text`, so the taxonomy can grow
 * — e.g. populating the Operations nodes — without a schema migration.
 *
 * This module defines the Operations, Process, and Concepts & Skills node trees
 * and the cross-cutting tag vocabularies, the doc-class / source-disposition /
 * authority-role vocabularies, the ceiling / handoff vocabularies, and the
 * Blitz→node mapping (guarded by a drift test). The Operations root is the
 * human-owned "how the membership works / where to get help" truth; its docs
 * are authored from this registry by seed-operations-kb.ts.
 */

import { BLITZ_SECTION_IDS } from "@workspace/blitz-curriculum";

// ───────────────────────────────────────────────────────────────────────────
// Home roots — every doc has exactly one mutually-exclusive home root.
// ───────────────────────────────────────────────────────────────────────────

export interface TaxonomyRoot {
  slug: string;
  label: string;
  description: string;
}

export const HOME_ROOTS: readonly TaxonomyRoot[] = [
  {
    slug: "process",
    label: "Process",
    description: "The campaign lifecycle / build stages — hugs the Blitz curriculum.",
  },
  {
    slug: "concepts",
    label: "Concepts & Skills",
    description: "Marketing concepts: angles, headlines, creative strategy, testing methodology.",
  },
  {
    slug: "operations",
    label: "Operations",
    description: "Membership, refunds, call hours, support, \"how to get help\" — the handoff hub. Nodes authored in Task #3.",
  },
] as const;

export const HOME_ROOT_SLUGS: readonly string[] = HOME_ROOTS.map((r) => r.slug);

/**
 * The Operations root — the basic-support / "how to get help" hub. The voice
 * assistant scopes its KB retrieval to exactly this root (basic support line);
 * deeper Process/Concepts questions are handed off to the chat assistant.
 */
export const OPERATIONS_ROOT_SLUG = "operations";

/**
 * The KB `category` values that carry citable member-facing taxonomy content.
 * Every authored citable doc is seeded with `category = home_root` (see
 * seed-operations-kb / seed-process-kb / seed-concepts-kb), so the citable
 * category vocabulary is exactly the home-root vocabulary. Surface scoping
 * (voice → Operations only; chat → all roots) is expressed as a subset of this
 * list — scoping by category here is equivalent to scoping by home root because
 * the two columns are kept in lockstep by the seeders.
 */
export const CITABLE_KB_CATEGORIES: readonly string[] = HOME_ROOT_SLUGS;

/**
 * Default home for un-migrated / un-homed docs. Operations is the catch-all
 * "handoff hub" root, so an un-classified doc falls back here at read time
 * rather than crashing on a NULL home. (Held docs are not citable regardless,
 * so this fallback is structural, not a content decision.)
 */
export const DEFAULT_HOME_ROOT = "operations";

// ───────────────────────────────────────────────────────────────────────────
// Nodes — the node tree within each home root.
// ───────────────────────────────────────────────────────────────────────────

export interface TaxonomyNode {
  slug: string;
  root: string;
  label: string;
}

/**
 * Process nodes — campaign lifecycle stages that hug the Blitz curriculum's
 * four phases (intro → build → test → scale). The Blitz section ids map into
 * these via {@link BLITZ_SECTION_TO_NODE}.
 */
export const PROCESS_NODES: readonly TaxonomyNode[] = [
  { slug: "foundations",        root: "process", label: "Foundations & System Overview" },
  { slug: "network-and-offer",  root: "process", label: "Network & Offer Selection" },
  { slug: "creative-assets",    root: "process", label: "Creative Assets" },
  { slug: "compliance",         root: "process", label: "Compliance Review" },
  { slug: "tracking-and-setup", root: "process", label: "Tracking & Site Setup" },
  { slug: "launch",             root: "process", label: "Go Live" },
  { slug: "testing",            root: "process", label: "Testing Rounds" },
  { slug: "scaling",            root: "process", label: "Scaling" },
] as const;

/**
 * Concepts & Skills nodes — the marketing-craft topics that cut across the
 * lifecycle (a member learns "headlines" once, applies it at several stages).
 */
export const CONCEPT_NODES: readonly TaxonomyNode[] = [
  { slug: "angles",               root: "concepts", label: "Angles" },
  { slug: "headlines-and-copy",   root: "concepts", label: "Headlines & Copy" },
  { slug: "creative-strategy",    root: "concepts", label: "Creative Strategy" },
  { slug: "offer-strategy",       root: "concepts", label: "Offer Strategy" },
  { slug: "testing-methodology",  root: "concepts", label: "Testing Methodology" },
  { slug: "scaling-strategy",     root: "concepts", label: "Scaling Strategy" },
  { slug: "metrics-and-economics", root: "concepts", label: "Metrics & Unit Economics" },
  { slug: "traffic-and-placements", root: "concepts", label: "Traffic & Placements" },
] as const;

/**
 * Operations nodes (Task #3) — the human-owned "how the membership works /
 * how to get help" root. Derived from walking the current BTS portal
 * navigation (see {@link "./kb-portal-navigation-map"}). Operations is the
 * handoff hub: {@link HANDOFF_TARGETS} routes concept→coaching and
 * troubleshooting→support into the `coaching-access` and `support` nodes here.
 */
export const OPERATIONS_NODES: readonly TaxonomyNode[] = [
  { slug: "membership",         root: "operations", label: "Membership & Account" },
  { slug: "billing-and-refunds", root: "operations", label: "Billing & Refunds" },
  { slug: "coaching-access",    root: "operations", label: "Coaching Access & Schedule" },
  { slug: "support",            root: "operations", label: "Support & Escalation" },
  { slug: "getting-help",       root: "operations", label: "Getting Help" },
  { slug: "navigation",         root: "operations", label: "Portal Navigation Map" },
] as const;

export const ALL_NODES: readonly TaxonomyNode[] = [
  ...PROCESS_NODES,
  ...CONCEPT_NODES,
  ...OPERATIONS_NODES,
];

const NODE_BY_SLUG: ReadonlyMap<string, TaxonomyNode> = new Map(
  ALL_NODES.map((n) => [n.slug, n]),
);

// ───────────────────────────────────────────────────────────────────────────
// Node importance — the depth-gap calibration signal (Synthesis Engine Part 2).
// ───────────────────────────────────────────────────────────────────────────

/**
 * The highest-demand / highest-stakes nodes. Synthesis Engine Part 2 uses this
 * (together with a per-node source-count threshold) to decide when to raise an
 * ADVISORY "depth gap" flag in the coverage view — i.e. "this node matters and
 * has enough source material to justify a deeper doc, but the expected depth
 * tier isn't published yet." It is deliberately a curated SUBSET, not every
 * node: flagging everything would make the advisory noise. The flag is never a
 * publish blocker — it only nudges a human reviewer's attention.
 *
 * Chosen as the nodes a member hits first / most, where money is spent or made,
 * plus the Operations "how to get help" hub (the handoff surface):
 *  - Process:    foundations (entry), network-and-offer (first decision),
 *                testing (spend), scaling (profit).
 *  - Concepts:   angles + headlines-and-copy (top creative demand),
 *                testing-methodology, metrics-and-economics.
 *  - Operations: billing-and-refunds (money/policy), coaching-access,
 *                getting-help, navigation (the help/handoff surface).
 */
export const HIGH_IMPORTANCE_NODES: ReadonlySet<string> = new Set([
  "foundations",
  "network-and-offer",
  "testing",
  "scaling",
  "angles",
  "headlines-and-copy",
  "testing-methodology",
  "metrics-and-economics",
  "billing-and-refunds",
  "coaching-access",
  "getting-help",
  "navigation",
]);

export type NodeImportance = "high" | "normal";

/** A node's importance tier — 'high' for the curated high-demand set, else 'normal'. */
export function nodeImportance(slug: string): NodeImportance {
  return HIGH_IMPORTANCE_NODES.has(slug) ? "high" : "normal";
}

// ───────────────────────────────────────────────────────────────────────────
// Ceiling + handoff — the depth-ceiling / handoff mechanism (foundation §3.6).
// ───────────────────────────────────────────────────────────────────────────

/**
 * A doc's depth domain — how far it can answer before it should hand off. This
 * is the lever Task #6 wires into the answer-time prompts; it is captured as
 * controlled data here so authoring (Task #2) and answer-time stay aligned.
 * - operational:    factual ops/policy answers (membership, refunds, hours, nav).
 *                   Account-specific actions hand off to support.
 * - conceptual:     grounded concept/strategy explanation. Deeper, member-specific
 *                   strategy hands off to live coaching.
 * - troubleshooting: known fixes / how-tos. Unresolved issues hand off to support.
 */
export const CEILINGS = ["operational", "conceptual", "troubleshooting"] as const;
export type Ceiling = (typeof CEILINGS)[number];

/**
 * Where a doc hands off when its ceiling is hit. Both destinations live in the
 * Operations root (the handoff hub): a concept question that exceeds grounded
 * depth → live coaching; a troubleshooting/ops question the KB can't resolve →
 * support. {@link HANDOFF_TARGET_NODES} maps each target to the Operations node
 * that actually holds the destination content.
 */
export const HANDOFF_TARGETS = ["coaching", "support"] as const;
export type HandoffTarget = (typeof HANDOFF_TARGETS)[number];

/** The Operations node each handoff target routes into. */
export const HANDOFF_TARGET_NODES: Readonly<Record<HandoffTarget, string>> = {
  coaching: "coaching-access",
  support: "support",
};

// ───────────────────────────────────────────────────────────────────────────
// Tags — cross-cutting vocabularies (a doc may carry several).
// ───────────────────────────────────────────────────────────────────────────

/** Concept tags — what marketing idea a doc touches. */
export const CONCEPT_TAGS: readonly string[] = [
  "angle",
  "headline",
  "hook",
  "copywriting",
  "creative",
  "landing-page",
  "native-ad",
  "offer",
  "funnel",
  "tracking",
  "compliance",
  "testing",
  "scaling",
  "budget",
  "metrics",
  "conversion",
  "audience",
  "placement",
] as const;

/**
 * Tool / software tags — the named platforms across the current BTS product
 * inventory: in-house software, the partner tools on the Tools page, the ad
 * publishers (source-protected code names), and the affiliate networks.
 * Retired products (NoEscape, LeiaPix/Immersity, MediaGo, LiveIntent, and the
 * native networks Taboola/Outbrain/Revcontent/MGID) are deliberately excluded.
 */
export const TOOL_TAGS: readonly string[] = [
  // In-house software.
  "flexy",
  "diytrax",
  "metricmover",
  "gifster",
  "pixelpress",
  "scrapebot",
  "cropbot",
  // Partner tools (Tools page).
  "affiliate-cmo",
  "freeadcopy",
  "anstrex",
  // Ad publishers (source-protected code names).
  "caterpillar",
  "grasshopper",
  "crane",
  // Affiliate networks.
  "media-mavens",
  "clickbank",
] as const;

/** Single troubleshooting tag — marks a doc as fix-it / error-resolution. */
export const TROUBLESHOOTING_TAG = "troubleshooting";

export const ALL_TAGS: readonly string[] = [
  ...CONCEPT_TAGS,
  ...TOOL_TAGS,
  TROUBLESHOOTING_TAG,
];

const TAG_SET: ReadonlySet<string> = new Set(ALL_TAGS);

// ───────────────────────────────────────────────────────────────────────────
// Functional tag detection — turn the concept/tool tags into retrieval levers.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Member-facing phrasings that map a free-text query onto a controlled tag.
 * Used by surface-aware retrieval to BOOST docs carrying the matched tag (e.g.
 * "Flexy" → boost `tool:flexy` docs), rather than relying on the literal word
 * appearing in the doc body. Triggers are matched on word boundaries (the query
 * is normalised + space-padded), so "test" does not match inside "latest".
 *
 * Every key MUST be a member of {@link ALL_TAGS}; guarded by a unit test.
 */
export const TAG_TRIGGERS: Readonly<Record<string, readonly string[]>> = {
  // Tool / software tags — in-house software.
  flexy: ["flexy"],
  diytrax: ["diytrax", "diy trax", "diy tracks"],
  metricmover: ["metricmover", "metric mover"],
  gifster: ["gifster", "gif ster"],
  pixelpress: ["pixelpress", "pixel press"],
  scrapebot: ["scrapebot", "scrape bot"],
  cropbot: ["cropbot", "crop bot"],
  // Partner tools (Tools page).
  "affiliate-cmo": ["affiliate cmo", "affiliatecmo"],
  freeadcopy: ["freeadcopy", "free ad copy"],
  anstrex: ["anstrex"],
  // Ad publishers (source-protected code names).
  caterpillar: ["caterpillar"],
  grasshopper: ["grasshopper", "grass hopper"],
  crane: ["crane"],
  // Affiliate networks.
  "media-mavens": ["media mavens", "mediamavens", "media maven"],
  clickbank: ["clickbank", "click bank"],
  // Concept tags.
  angle: ["angle", "angles"],
  headline: ["headline", "headlines"],
  hook: ["hook", "hooks"],
  copywriting: ["copywriting", "copy writing", "copywriter"],
  creative: ["creative", "creatives", "ad creative", "ad creatives"],
  "landing-page": ["landing page", "landing pages", "lander", "landers"],
  "native-ad": ["native ad", "native ads", "native advertising"],
  offer: ["offer", "offers"],
  funnel: ["funnel", "funnels"],
  tracking: ["tracking", "tracker", "pixel tracking"],
  compliance: ["compliance", "compliant"],
  testing: ["testing", "split test", "split testing", "a b test", "ab test"],
  scaling: ["scaling", "scale up", "scale out"],
  budget: ["budget", "budgets", "budgeting"],
  metrics: ["metrics", "kpi", "kpis"],
  conversion: ["conversion", "conversions"],
  audience: ["audience", "audiences"],
  placement: ["placement", "placements"],
};

/**
 * Normalise free text for trigger matching: lowercase, strip accents, collapse
 * punctuation/whitespace to single spaces, and pad with surrounding spaces so
 * multi-word triggers match on word boundaries. Mirrors the voice-synonyms
 * normaliser so the two layers behave identically.
 */
export function normalizeForTagMatch(text: string): string {
  const collapsed = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return collapsed ? ` ${collapsed} ` : "";
}

/**
 * Pure trigger matcher: given a query, an ordered tag list, and a per-tag
 * trigger map, return the (deduped) tags whose triggers fire, in list order.
 * Shared by the code-baseline {@link detectQueryTags} here and the DB-backed
 * EFFECTIVE detector in kb-tool-tags (which merges concept + troubleshooting
 * with the admin-managed tool tags).
 */
export function detectTagsFromTriggers(
  query: string,
  tags: readonly string[],
  triggersByTag: Readonly<Record<string, readonly string[]>>,
): string[] {
  const haystack = normalizeForTagMatch(query);
  if (!haystack) return [];
  const matched: string[] = [];
  for (const tag of tags) {
    const triggers = triggersByTag[tag];
    if (!triggers) continue;
    const hit = triggers.some((t) => {
      const needle = normalizeForTagMatch(t);
      return needle !== "" && haystack.includes(needle);
    });
    if (hit) matched.push(tag);
  }
  return matched;
}

/**
 * Detect which controlled tags a member query references, so retrieval can boost
 * docs carrying those tags. Returns the (deduped) tag slugs in registry order.
 * Empty when nothing matches (the common case).
 *
 * NOTE: this is the CODE-BASELINE detector over the hard-coded registry. The
 * live retrieval/triage paths use the DB-backed EFFECTIVE detector in
 * kb-tool-tags, which merges these concept/troubleshooting tags with the
 * admin-managed tool tags.
 */
export function detectQueryTags(query: string): string[] {
  return detectTagsFromTriggers(query, ALL_TAGS, TAG_TRIGGERS);
}

// ───────────────────────────────────────────────────────────────────────────
// Doc class — how a doc may be used by the assistant.
// ───────────────────────────────────────────────────────────────────────────

/**
 * - curated:    a verified, citable answer doc (FAQ, glossary, tool guide...).
 * - overview:   a verified, citable orientation / map doc.
 * - transcript: training-only material derived from a recording; NEVER citable
 *               and excluded from every member-facing retrieval path.
 */
export const DOC_CLASSES = ["curated", "overview", "transcript"] as const;
export type DocClass = (typeof DOC_CLASSES)[number];

/** Doc classes that may appear in a member-facing answer (still gated on last_verified). */
export const CITABLE_DOC_CLASSES: readonly DocClass[] = ["curated", "overview"];

/**
 * KB categories whose docs are transcript-derived training material. Single
 * source for both the seed-path classifier and the reclassify boot hook so the
 * two can never drift. ~485 of 602 live docs fall in these two categories.
 */
export const TRANSCRIPT_CATEGORIES = ["coaching", "curriculum"] as const;

/** Classify a doc by its KB category. Transcript categories → 'transcript'. */
export function docClassForCategory(category: string | null | undefined): DocClass {
  return (TRANSCRIPT_CATEGORIES as readonly string[]).includes((category ?? "").trim())
    ? "transcript"
    : "curated";
}

// ───────────────────────────────────────────────────────────────────────────
// Source disposition + authority role (kb_transcript_sources).
// ───────────────────────────────────────────────────────────────────────────

/**
 * - training:    a member-facing source that may be mined into draft truth.
 * - quarantined: an internal / non-member recording — excluded from member
 *                answers AND from the mining/authoring pipeline. Conservative
 *                default for anything unidentifiable.
 */
export const SOURCE_DISPOSITIONS = ["training", "quarantined"] as const;
export type SourceDisposition = (typeof SOURCE_DISPOSITIONS)[number];

export const DEFAULT_SOURCE_DISPOSITION: SourceDisposition = "quarantined";

/**
 * Authority role mirrors the live `coaches.type` vocabulary, plus two
 * source-only roles:
 * - strategic_coach: LIVE Coaching Calls (Bruce, Michael, Sasha, Todd).
 * - va:              per-coach 1:1 pool (John, Neil, Mikha) — authoritative for
 *                    software / tools / basic setup, NOT for strategy claims.
 * - curriculum:      official training videos.
 * - internal:        quarantined / non-member recordings (conservative default).
 */
export const AUTHORITY_ROLES = ["strategic_coach", "va", "curriculum", "internal"] as const;
export type AuthorityRole = (typeof AUTHORITY_ROLES)[number];

export const DEFAULT_AUTHORITY_ROLE: AuthorityRole = "internal";

// ───────────────────────────────────────────────────────────────────────────
// Source folders — the AI Source Knowledge library organisation.
// ───────────────────────────────────────────────────────────────────────────

/**
 * The raw-source layer (ai_source_documents) is organised into seven folders
 * by source type: five transcript/video types and two document types. Each
 * folder declares its coarse kind and a default authority role (mirroring the
 * source-screening vocabulary) so an import can pre-fill sensible roles. This
 * is the single source of truth for the folder vocabulary, mirrored verbatim
 * by the admin AI Source Knowledge page.
 */
export interface SourceFolder {
  slug: string;
  label: string;
  /** Coarse kind: transcript-derived, video-derived, or a document. */
  kind: "transcript" | "video" | "document";
  defaultAuthorityRole: AuthorityRole;
}

export const SOURCE_FOLDERS: readonly SourceFolder[] = [
  { slug: "group_coaching",  label: "Group Coaching",   kind: "transcript", defaultAuthorityRole: "strategic_coach" },
  { slug: "private_coaching", label: "Private Coaching", kind: "transcript", defaultAuthorityRole: "strategic_coach" },
  { slug: "one_on_one_va",   label: "1-on-1 VA",        kind: "transcript", defaultAuthorityRole: "va" },
  { slug: "blitz_video",     label: "Blitz Video",      kind: "video",      defaultAuthorityRole: "curriculum" },
  { slug: "other_video",     label: "Other Video",      kind: "video",      defaultAuthorityRole: "curriculum" },
  { slug: "reference_docs",  label: "Reference Docs",   kind: "document",   defaultAuthorityRole: "internal" },
  { slug: "other_docs",      label: "Other Docs",       kind: "document",   defaultAuthorityRole: "internal" },
] as const;

export const SOURCE_FOLDER_SLUGS: readonly string[] = SOURCE_FOLDERS.map((f) => f.slug);

const SOURCE_FOLDER_BY_SLUG: ReadonlyMap<string, SourceFolder> = new Map(
  SOURCE_FOLDERS.map((f) => [f.slug, f]),
);

export function isSourceFolder(value: unknown): value is string {
  return typeof value === "string" && SOURCE_FOLDER_BY_SLUG.has(value);
}

export function resolveSourceFolder(slug: string | null | undefined): SourceFolder | null {
  return slug ? SOURCE_FOLDER_BY_SLUG.get(slug) ?? null : null;
}

const SOURCE_FOLDER_BY_LABEL: ReadonlyMap<string, SourceFolder> = new Map(
  SOURCE_FOLDERS.map((f) => [f.label.trim().toLowerCase(), f]),
);

/**
 * Resolve a folder by its human label (e.g. the "folder" value carried in the
 * transcript triage manifest — "Group Coaching", "1-on-1 VA", …) to its
 * registry entry. SOURCE_FOLDERS is the single source of truth for the
 * label→slug mapping; case/whitespace insensitive.
 */
export function resolveSourceFolderByLabel(label: string | null | undefined): SourceFolder | null {
  return label ? SOURCE_FOLDER_BY_LABEL.get(label.trim().toLowerCase()) ?? null : null;
}

/**
 * Map a live `coaches.type` value to an authority role. The roster is the
 * source of truth (Task #2 runs the name→type join over real sources); this is
 * the pure mapping half so role assignment stays correct if the roster changes.
 */
export function authorityRoleFromCoachType(coachType: string | null | undefined): AuthorityRole {
  switch ((coachType ?? "").trim().toLowerCase()) {
    case "strategic_coach":
    case "strategic":
    case "coach":
      return "strategic_coach";
    case "va":
      return "va";
    default:
      return DEFAULT_AUTHORITY_ROLE;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Blitz → Process node mapping (drift-guarded).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Maps every Blitz curriculum section id (1..23) to the Process node it lives
 * under. Guarded by kb-taxonomy-blitz-drift.test.ts: it must cover EXACTLY the
 * canonical Blitz section id set and every target must be a real Process node,
 * so the mapping can't silently rot when the curriculum changes.
 */
export const BLITZ_SECTION_TO_NODE: Readonly<Record<number, string>> = {
  1: "foundations",
  2: "foundations",
  3: "foundations",
  4: "network-and-offer",
  5: "network-and-offer",
  6: "creative-assets",
  7: "creative-assets",
  8: "creative-assets",
  9: "creative-assets",
  10: "compliance",
  11: "tracking-and-setup",
  12: "tracking-and-setup",
  13: "tracking-and-setup",
  14: "launch",
  15: "testing",
  16: "testing",
  17: "testing",
  18: "testing",
  19: "testing",
  20: "testing",
  21: "scaling",
  22: "scaling",
  23: "scaling",
};

/** Canonical Blitz section id set (re-exported for the drift guard). */
export const BLITZ_TAXONOMY_SECTION_IDS = BLITZ_SECTION_IDS;

// ───────────────────────────────────────────────────────────────────────────
// Validators / resolvers.
// ───────────────────────────────────────────────────────────────────────────

export function isHomeRoot(value: unknown): value is string {
  return typeof value === "string" && HOME_ROOT_SLUGS.includes(value);
}

export function isNode(value: unknown): value is string {
  return typeof value === "string" && NODE_BY_SLUG.has(value);
}

export function isProcessNode(value: unknown): boolean {
  const n = typeof value === "string" ? NODE_BY_SLUG.get(value) : undefined;
  return !!n && n.root === "process";
}

export function isTag(value: unknown): value is string {
  return typeof value === "string" && TAG_SET.has(value);
}

export function isDocClass(value: unknown): value is DocClass {
  return typeof value === "string" && (DOC_CLASSES as readonly string[]).includes(value);
}

export function isCitableDocClass(value: unknown): boolean {
  return typeof value === "string" && (CITABLE_DOC_CLASSES as readonly string[]).includes(value);
}

export function isCeiling(value: unknown): value is Ceiling {
  return typeof value === "string" && (CEILINGS as readonly string[]).includes(value);
}

export function isHandoffTarget(value: unknown): value is HandoffTarget {
  return typeof value === "string" && (HANDOFF_TARGETS as readonly string[]).includes(value);
}

export function isOperationsNode(value: unknown): boolean {
  const n = typeof value === "string" ? NODE_BY_SLUG.get(value) : undefined;
  return !!n && n.root === "operations";
}

/** Resolve a handoff target to the Operations node that holds its content. */
export function resolveHandoffNode(handoff: string | null | undefined): string | null {
  return isHandoffTarget(handoff) ? HANDOFF_TARGET_NODES[handoff] : null;
}

/** Filter a candidate tag list down to the registry-controlled vocabulary. */
export function normalizeTags(tags: readonly string[] | null | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  for (const t of tags) {
    const slug = typeof t === "string" ? t.trim().toLowerCase() : "";
    if (slug && TAG_SET.has(slug)) seen.add(slug);
  }
  return [...seen];
}

/** Resolve a doc's effective home root, falling back to the default. */
export function resolveHomeRoot(homeRoot: string | null | undefined): string {
  return isHomeRoot(homeRoot) ? homeRoot : DEFAULT_HOME_ROOT;
}
