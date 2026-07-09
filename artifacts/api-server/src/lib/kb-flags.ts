/**
 * KB risk-flag computation (Task #2, steps 10 + 13).
 *
 * Replaces the old confidence-SCORE auto-triage with explicit, human-readable
 * FLAGS that drive review. A draft is never auto-approved or auto-rejected for
 * members; instead the reviewer sees why a doc needs attention (conflict with a
 * verified doc, single-source vs corroborated, high-stakes claim, weak/internal
 * source, VA-sourced strategy, possible duplicate, stale/legacy references).
 *
 * The core `computeRiskFlags` is PURE (testable); `gatherFlagContext` does the
 * one DB round-trip needed for duplicate / conflict detection.
 */

import { db } from "@workspace/db";
import { knowledgebaseDocsTable } from "@workspace/db/schema";
import { eq, isNotNull, and } from "drizzle-orm";
import { scrubPrivateContent } from "./content-privacy-filter";
import { ALL_NODES, getNodeBySlug, isHomeRoot, NODE_NEIGHBORS } from "./kb-taxonomy.js";
import {
  hasSourceConflictMarker,
  hasNavigationConflictMarker,
  hasSynthesisRiskTags,
  hasTimeSensitivePhrasing,
  hasPrivacyResidue,
} from "./kb-review-risk";

export type FlagSeverity = "critical" | "high" | "medium" | "low";

export type RiskFlagType =
  | "conflict"
  | "high_stakes"
  | "va_sourced_strategy"
  | "weak_source"
  | "stale_legacy"
  | "single_source"
  | "possible_duplicate"
  // Review-gate flags (Task #1752) — signals threaded from synthesis or found
  // in the draft text itself. Computed via the pure detectors in kb-review-risk.
  | "source_conflict"
  | "navigation_conflict"
  // Boot-time nav drift scan (Task #1778) — appended by kb-nav-drift-scan when
  // the portal nav map changes after a draft was written.
  | "navigation_drift"
  | "situational_content"
  | "time_sensitive"
  | "privacy_residue"
  // "Related topics" hygiene (Task #1801): the draft's Related-topics list
  // names taxonomy topics that don't match the doc's placement, or is the
  // boilerplate every-sibling dump. Non-critical — guides the human edit.
  | "related_topics_mismatch"
  // Retrieval self-test (Task #1804): the draft failed some of its own
  // AI-generated member questions through the real retrieval path — likely too
  // thin / missing the vocabulary members would actually use. Non-critical.
  | "retrieval_gap";

export interface RiskFlag {
  type: RiskFlagType;
  severity: FlagSeverity;
  message: string;
  detail?: string;
}

const SEVERITY_RANK: Record<FlagSeverity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

/** Highest severity in a flag list (null when empty). */
export function maxSeverity(flags: readonly RiskFlag[]): FlagSeverity | null {
  let best: FlagSeverity | null = null;
  for (const f of flags) {
    if (best === null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[best]) best = f.severity;
  }
  return best;
}

/** Flags that must block bulk-confirm (require explicit per-doc adjudication). */
export function blocksBulkConfirm(flags: readonly RiskFlag[]): boolean {
  return flags.some(
    (f) => f.type === "conflict" || f.type === "high_stakes" || f.type === "source_conflict",
  );
}

// ── Pattern vocabularies ─────────────────────────────────────────────────────

/**
 * Legacy / stale references that must be translated to current BTS truth before
 * a doc is verified: old brand names, retired coach surnames, dropped affiliate
 * networks, old email domains.
 */
export const STALE_LEGACY_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bTCE\b/, label: "TCE (legacy brand)" },
  { re: /\bch[ae]rrington\b/i, label: "Cherrington (legacy brand)" },
  { re: /\bbobilev\b/i, label: "retired coach surname" },
  { re: /\bwissbaum\b/i, label: "retired coach surname" },
  { re: /\brupp\b/i, label: "retired coach surname" },
  { re: /\bsheph?[ae]rd\b/i, label: "retired coach surname" },
  { re: /\bmaxweb\b/i, label: "dropped affiliate network (MaxWeb)" },
  { re: /\baffiliati\b/i, label: "dropped affiliate network (Affiliati)" },
  { re: /@(?:thecherringtongroup|tce)\.\w+/i, label: "legacy email domain" },
];

/**
 * High-stakes topics: money / earnings claims, guarantees, refunds, legal,
 * compliance, medical, tax. A draft touching these must be human-verified with
 * extra care and can never be bulk-confirmed.
 */
export const HIGH_STAKES_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bguarantee[ds]?\b/i, label: "guarantee claim" },
  { re: /\brefund(s|ed|ing)?\b/i, label: "refund policy" },
  { re: /\b(income|earnings?|profit|revenue)\b/i, label: "income / earnings claim" },
  { re: /\bpassive income\b/i, label: "income claim" },
  { re: /\b(medical|health|supplement dosage)\b/i, label: "medical claim" },
  { re: /\b(legal|liability|lawsuit|disclaimer)\b/i, label: "legal claim" },
  { re: /\b(compliance|FTC|regulat\w+)\b/i, label: "compliance topic" },
  { re: /\btax(es|able)?\b/i, label: "tax topic" },
];

/** Doc-class targets that represent strategy (not pure software/setup mechanics). */
const STRATEGY_DOC_CLASSES = new Set(["strategy", "curated", "overview"]);

function matchPatterns(
  text: string,
  patterns: ReadonlyArray<{ re: RegExp; label: string }>,
): string[] {
  const hits: string[] = [];
  for (const { re, label } of patterns) {
    if (re.test(text)) hits.push(label);
  }
  return hits;
}

// ── "Related topics" hygiene (Task #1801) ────────────────────────────────────
//
// Synthesized drafts end with a "## Related topics" section. Historically this
// was the every-sibling dump (and sometimes lists topics from a different
// shelf entirely, e.g. "Billing & Refunds" on a testing doc). The assistant
// reads these lists as prose, so off-subject entries waste context and mislead.
// This pure check compares the list against the doc's taxonomy placement:
//  - an entry naming a taxonomy topic from a root the doc's placement doesn't
//    pair with (process↔concepts pair; operations stands alone) is a MISMATCH;
//  - a list reproducing an ENTIRE root's node list (minus at most the doc's
//    own node) is the generic BOILERPLATE default.
// Entries that don't match any taxonomy label are ignored (free-prose topics
// are the reviewer's call), keeping false positives off genuinely-edited lists.

const NODE_BY_LABEL: ReadonlyMap<string, { slug: string; root: string; label: string }> = new Map(
  ALL_NODES.map((n) => [n.label.trim().toLowerCase(), n]),
);

/** Extract the bullet entries of the draft's "## Related topics" section ([] when absent). */
export function parseRelatedTopicEntries(content: string): string[] {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => /^##\s+related topics\s*$/i.test(l.trim()));
  if (start === -1) return [];
  const entries: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^##[^#]/.test(line)) break; // next section
    const m = line.match(/^[-*]\s+(.+?)\s*$/);
    if (m) entries.push(m[1].replace(/\*\*/g, "").trim());
  }
  return entries;
}

/** The roots whose topics legitimately appear in a doc's Related-topics list. */
function allowedRootsFor(docRoot: string): ReadonlySet<string> {
  if (docRoot === "process" || docRoot === "concepts") return new Set(["process", "concepts"]);
  return new Set([docRoot]);
}

/**
 * Compute the related_topics_mismatch flag for a draft (null when clean or
 * when the doc's placement is unknown / no Related-topics section exists).
 */
export function computeRelatedTopicsFlag(input: {
  content: string;
  homeRoot?: string | null;
  node?: string | null;
}): RiskFlag | null {
  const entries = parseRelatedTopicEntries(input.content);
  if (entries.length === 0) return null;

  const docNode = getNodeBySlug(input.node ?? null);
  const docRoot = docNode?.root ?? (isHomeRoot(input.homeRoot) ? input.homeRoot! : null);
  if (!docRoot) return null; // no placement to judge against

  const allowedRoots = allowedRootsFor(docRoot);
  const neighborSlugs = new Set(docNode ? NODE_NEIGHBORS[docNode.slug] ?? [] : []);

  // Mismatched entries: named taxonomy topics outside the allowed roots (and
  // not an explicitly-curated neighbor).
  const matched = entries
    .map((e) => ({ entry: e, node: NODE_BY_LABEL.get(e.trim().toLowerCase()) ?? null }))
    .filter((x) => x.node !== null) as Array<{ entry: string; node: { slug: string; root: string; label: string } }>;
  const mismatched = matched.filter(
    (x) => !allowedRoots.has(x.node.root) && !neighborSlugs.has(x.node.slug),
  );

  // Boilerplate: the list reproduces an entire root's node list (minus at most
  // the doc's own node) — the generic every-sibling default.
  const matchedSlugs = new Set(matched.map((x) => x.node.slug));
  const boilerplateRoots: string[] = [];
  for (const root of new Set(ALL_NODES.map((n) => n.root))) {
    const rootSlugs = ALL_NODES.filter((n) => n.root === root).map((n) => n.slug);
    const expected = rootSlugs.filter((s) => s !== docNode?.slug);
    if (expected.length >= 2 && expected.every((s) => matchedSlugs.has(s))) {
      boilerplateRoots.push(root);
    }
  }

  if (mismatched.length === 0 && boilerplateRoots.length === 0) return null;

  const parts: string[] = [];
  if (mismatched.length > 0) {
    parts.push(
      `Off-subject entries for this doc's placement (${docNode ? docNode.label : docRoot}): ${mismatched
        .map((x) => `"${x.entry}"`)
        .join(", ")}.`,
    );
  }
  if (boilerplateRoots.length > 0) {
    parts.push(
      `Lists every ${boilerplateRoots.join(" + ")} topic — the generic default list, not genuinely adjacent subjects.`,
    );
  }
  return {
    type: "related_topics_mismatch",
    severity: "medium",
    message: "Related-topics list doesn't match the doc's subject",
    detail: `${parts.join(" ")} Trim the "Related topics" section to genuinely adjacent topics before publishing.`,
  };
}

// ── Retrieval self-test flag (Task #1804) ────────────────────────────────────

/**
 * Compute the retrieval_gap flag from a stored self-test result. Pure. Flags
 * whenever at least one member question failed; the detail names the failing
 * questions so the reviewer knows which vocabulary to fold into the draft.
 * NON-critical by design (medium) — it never trips needsExpert and never
 * blocks bulk confirm; it guides the human edit.
 */
export function computeRetrievalSelfTestFlag(selfTest: {
  results: Array<{ question: string; passed: boolean }>;
} | null | undefined): RiskFlag | null {
  if (!selfTest || !Array.isArray(selfTest.results) || selfTest.results.length === 0) return null;
  const failing = selfTest.results.filter((r) => !r.passed);
  if (failing.length === 0) return null;
  const total = selfTest.results.length;
  return {
    type: "retrieval_gap",
    severity: "medium",
    message: `Fails retrieval self-test (${failing.length}/${total} member questions)`,
    detail: `The assistant likely would NOT find this doc for: ${failing
      .map((f) => `"${f.question}"`)
      .join("; ")}. Consider adding the member's own vocabulary for these asks to the draft.`,
  };
}

// ── Pure flag computation ────────────────────────────────────────────────────

export interface ComputeFlagsInput {
  title: string;
  content: string;
  authorityRole?: string | null;
  docClassTarget?: string | null;
  homeRoot?: string | null;
  /** Taxonomy node slug the doc is filed under (drives Related-topics hygiene). */
  node?: string | null;
  /** How many distinct sources corroborate this claim (>=2 = corroborated). */
  corroborationCount?: number;
  /** Title of an existing live doc this draft would overwrite (duplicate). */
  duplicateTitle?: string | null;
  /** Set when the duplicate is a human-VERIFIED doc → true conflict. */
  conflictsWithVerified?: boolean;
}

export function computeRiskFlags(input: ComputeFlagsInput): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const haystack = `${input.title}\n${input.content}`;
  const role = (input.authorityRole ?? "").trim();

  // Conflict / duplicate.
  if (input.duplicateTitle) {
    if (input.conflictsWithVerified) {
      flags.push({
        type: "conflict",
        severity: "critical",
        message: "Conflicts with a human-verified live doc",
        detail: `A verified doc titled "${input.duplicateTitle}" already exists — adjudicate before overwriting.`,
      });
    } else {
      flags.push({
        type: "possible_duplicate",
        severity: "medium",
        message: "Possible duplicate of an existing doc",
        detail: `An existing doc titled "${input.duplicateTitle}" may cover the same material.`,
      });
    }
  }

  // High-stakes claims.
  const highStakes = matchPatterns(haystack, HIGH_STAKES_PATTERNS);
  if (highStakes.length > 0) {
    flags.push({
      type: "high_stakes",
      severity: "high",
      message: "High-stakes content — verify carefully",
      detail: highStakes.join(", "),
    });
  }

  // VA-sourced strategy: VAs are authoritative for software/setup, NOT strategy.
  if (role === "va" && STRATEGY_DOC_CLASSES.has((input.docClassTarget ?? "").trim())) {
    flags.push({
      type: "va_sourced_strategy",
      severity: "high",
      message: "Strategy claim sourced from a VA call",
      detail: "VAs are authoritative for software/tools/setup, not strategy — confirm against a coach source.",
    });
  }

  // Weak source: VA or internal authority for a citable claim.
  if (role === "va" || role === "internal") {
    flags.push({
      type: "weak_source",
      severity: "medium",
      message: `Weak source authority (${role || "unknown"})`,
      detail: "Source is not a strategic coach / official curriculum.",
    });
  }

  // Stale / legacy references.
  const stale = matchPatterns(haystack, STALE_LEGACY_PATTERNS);
  if (stale.length > 0) {
    flags.push({
      type: "stale_legacy",
      severity: "medium",
      message: "Contains stale / legacy references",
      detail: stale.join(", "),
    });
  }

  // ── Review-gate flags (Task #1752) ─────────────────────────────────────────
  // Signals threaded from synthesis (inline tags + conflict blockquotes) plus
  // content-level risk phrasing. Detectors are pure (kb-review-risk).

  // Unresolved SOURCE CONFLICT blockquote left in the draft body.
  if (hasSourceConflictMarker(input.content)) {
    flags.push({
      type: "source_conflict",
      severity: "critical",
      message: "Unresolved source conflict in draft",
      detail:
        "The draft body contains a \"SOURCE CONFLICT (for reviewer)\" blockquote from synthesis — adjudicate and rewrite/remove it before publishing.",
    });
  }

  // Unresolved NAVIGATION CONFLICT blockquote (navigation grounding, #1778).
  if (hasNavigationConflictMarker(input.content)) {
    flags.push({
      type: "navigation_conflict",
      severity: "high",
      message: "Unresolved navigation conflict in draft",
      detail:
        "The draft body contains a \"NAVIGATION CONFLICT (for reviewer)\" blockquote — it references a legacy portal location. Rewrite to the current page name/path and remove the blockquote before publishing.",
    });
  }

  // Situational / context-bound / anomaly material carried through synthesis.
  if (hasSynthesisRiskTags(input.content)) {
    flags.push({
      type: "situational_content",
      severity: "high",
      message: "Situational / context-bound material",
      detail:
        "Contains [SITUATIONAL], [CONTEXT-BOUND] or [ANOMALY] passages from synthesis — verify figures stay context-bound illustrations, never universal targets.",
    });
  }

  // Time-sensitive phrasing that will age.
  if (hasTimeSensitivePhrasing(input.content)) {
    flags.push({
      type: "time_sensitive",
      severity: "medium",
      message: "Time-sensitive phrasing",
      detail: "Phrases like \"right now\"/\"currently\"/dated references will age — rewrite timelessly or confirm.",
    });
  }

  // Residual private content (names/emails/phones/old brand) still in the text.
  if (hasPrivacyResidue(input.content)) {
    flags.push({
      type: "privacy_residue",
      severity: "high",
      message: "Residual private content",
      detail:
        "Matches the privacy scrub rules (member/coach name, email, phone or legacy brand). Auto-scrubbed at publish, but verify the passage reads correctly.",
    });
  }

  // "Related topics" list vs taxonomy placement (Task #1801).
  const relatedFlag = computeRelatedTopicsFlag({
    content: input.content,
    homeRoot: input.homeRoot,
    node: input.node,
  });
  if (relatedFlag) flags.push(relatedFlag);

  // Single-source vs corroborated.
  const corroboration = input.corroborationCount ?? 1;
  if (corroboration <= 1) {
    flags.push({
      type: "single_source",
      severity: "low",
      message: "Single-source claim (not corroborated)",
      detail: "Only one source supports this draft.",
    });
  }

  return flags;
}

// ── DB-backed context gathering ──────────────────────────────────────────────

export interface FlagContext {
  duplicateTitle: string | null;
  conflictsWithVerified: boolean;
}

/**
 * One DB round-trip: does a live doc with the same (scrubbed) title already
 * exist, and is it human-verified? A verified collision is a true conflict;
 * an unverified one is a possible duplicate.
 */
export async function gatherFlagContext(doc: {
  title: string;
  aiCleanedTitle?: string | null;
}): Promise<FlagContext> {
  const candidateTitle = scrubPrivateContent(doc.aiCleanedTitle?.trim() || doc.title);
  const [verified] = await db
    .select({ title: knowledgebaseDocsTable.title })
    .from(knowledgebaseDocsTable)
    .where(and(eq(knowledgebaseDocsTable.title, candidateTitle), isNotNull(knowledgebaseDocsTable.lastVerified)))
    .limit(1);
  if (verified) return { duplicateTitle: verified.title, conflictsWithVerified: true };

  const [dup] = await db
    .select({ title: knowledgebaseDocsTable.title })
    .from(knowledgebaseDocsTable)
    .where(eq(knowledgebaseDocsTable.title, candidateTitle))
    .limit(1);
  return { duplicateTitle: dup?.title ?? null, conflictsWithVerified: false };
}
