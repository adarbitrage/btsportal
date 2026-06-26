/**
 * AI-assistant domain taxonomy — the data-driven registry (Task #1 foundation).
 *
 * This is the SINGLE source of truth for the controlled vocabularies the
 * assistant's knowledge base is organised by. It is deliberately a declarative
 * data module (not Postgres enums and not TS union literals baked into the
 * schema): the DB columns (`home_root`, `node`, `tags`, `doc_class`, source
 * `disposition` / `authority_role`) are plain `text`, so the taxonomy can grow
 * — e.g. Task #3 populating the Operations nodes — without a schema migration.
 *
 * Scope of THIS task: define the Process + Concepts & Skills node trees and the
 * cross-cutting tag vocabularies, the doc-class / source-disposition /
 * authority-role vocabularies, and the Blitz→node mapping (guarded by a drift
 * test). Operations nodes are intentionally left empty here — they are authored
 * in Task #3.
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

/** Operations nodes are authored in Task #3 — intentionally empty here. */
export const OPERATIONS_NODES: readonly TaxonomyNode[] = [] as const;

export const ALL_NODES: readonly TaxonomyNode[] = [
  ...PROCESS_NODES,
  ...CONCEPT_NODES,
  ...OPERATIONS_NODES,
];

const NODE_BY_SLUG: ReadonlyMap<string, TaxonomyNode> = new Map(
  ALL_NODES.map((n) => [n.slug, n]),
);

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

/** Tool / software tags — the named platforms in the Blitz workflow. */
export const TOOL_TAGS: readonly string[] = [
  "flexy",
  "diytrax",
  "metricmover",
  "caterpillar",
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
