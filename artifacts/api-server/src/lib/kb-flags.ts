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

export type FlagSeverity = "critical" | "high" | "medium" | "low";

export type RiskFlagType =
  | "conflict"
  | "high_stakes"
  | "va_sourced_strategy"
  | "weak_source"
  | "stale_legacy"
  | "single_source"
  | "possible_duplicate";

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
  return flags.some((f) => f.type === "conflict" || f.type === "high_stakes");
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

// ── Pure flag computation ────────────────────────────────────────────────────

export interface ComputeFlagsInput {
  title: string;
  content: string;
  authorityRole?: string | null;
  docClassTarget?: string | null;
  homeRoot?: string | null;
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
