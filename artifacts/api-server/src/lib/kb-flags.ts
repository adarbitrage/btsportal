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
  // Retrieval self-test (Task #1804): the draft failed some of its own
  // AI-generated member questions through the real retrieval path — likely too
  // thin / missing the vocabulary members would actually use. Non-critical.
  | "retrieval_gap"
  // Citeable-only review pipeline (Task #1873): a review doc is filed under a
  // non-citeable class (e.g. legacy `transcript`). Review docs exist to be
  // published + cited, so this must be re-filed as a citeable class.
  | "non_citable_review_doc"
  // Blitz reference-doc import (Task #1914): the doc contains a member-facing
  // portal click-path ("Log in to your portal … Navigate to **X** > **Y**").
  // The reviewer must verify the path against the CURRENT portal navigation.
  // medium = a referenced label doesn't match the live nav map; low = all
  // referenced labels matched (still worth a click-through).
  | "portal_nav_check";

/**
 * Runtime roster of every {@link RiskFlagType}. The reviewer SOP (kb-sop.ts)
 * iterates this to build its flag catalog, so a new flag can't silently ship
 * without a SOP entry. The two type-level asserts below make this list and the
 * union mutually exhaustive: adding a flag to the union without listing it here
 * (or vice-versa) is a compile error.
 */
export const RISK_FLAG_TYPES = [
  "conflict",
  "high_stakes",
  "va_sourced_strategy",
  "weak_source",
  "stale_legacy",
  "single_source",
  "possible_duplicate",
  "source_conflict",
  "navigation_conflict",
  "navigation_drift",
  "situational_content",
  "time_sensitive",
  "privacy_residue",
  "retrieval_gap",
  "non_citable_review_doc",
  "portal_nav_check",
] as const;

// Mutual exhaustiveness: every listed value is a RiskFlagType, and every
// RiskFlagType is listed. Either direction failing is a compile error.
type _FlagsAreSubset = (typeof RISK_FLAG_TYPES)[number] extends RiskFlagType ? true : never;
type _FlagsAreSuperset = RiskFlagType extends (typeof RISK_FLAG_TYPES)[number] ? true : never;
const _assertFlagsSubset: _FlagsAreSubset = true;
const _assertFlagsSuperset: _FlagsAreSuperset = true;
void _assertFlagsSubset;
void _assertFlagsSuperset;

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
  /** Taxonomy node slug the doc is filed under (retained for callers; no longer drives any flag). */
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
