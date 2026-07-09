/**
 * One-time stale-navigation sweep over the synthesis review queue (Task #1808).
 *
 * Retroactively flags stale old-portal navigation in kb_staging_docs drafts
 * already sitting at status='needs_review' (synthesis pipeline output). Two
 * passes per draft:
 *
 *  1. Deterministic re-screen — re-runs the legacy-crosswalk location screen
 *     (kb-nav-grounding.applyNavigationScreen) so drafts written BEFORE a
 *     crosswalk expansion (e.g. "BTS Software", "Compliance Form") get the
 *     same NAVIGATION CONFLICT reviewer callouts future drafts get.
 *
 *  2. LLM navigation audit — the draft plus the CURRENT portal nav map are
 *     reviewed by the model to find portal-navigation claims that contradict
 *     the map, catching stale phrasings the crosswalk does not yet know about.
 *     Navigation inside tools (DIYTrax > Offer Pages, Flexy > Media Storage…)
 *     and on external sites (ClickBank, Media Mavens…) is legitimate and must
 *     be ignored.
 *
 * Both passes ONLY APPEND reviewer callouts — nothing is rewritten, the human
 * review gate stays absolute. The sweep is idempotent: existing callout lines
 * are stripped before auditing and already-flagged claims are never re-flagged.
 *
 * This module is invoked MANUALLY via scripts/sweep-stale-nav.ts — it must
 * never be wired into boot or any scheduler (explicit task decision).
 */

import { db } from "@workspace/db";
import { kbStagingDocsTable } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { renderNavigationMapLines } from "@workspace/portal-nav-map";
import { NAV_CONFLICT_MARKER, applyNavigationScreen } from "./kb-nav-grounding.js";

/** A single stale-navigation claim the LLM audit found in a draft. */
export interface NavAuditFinding {
  /** The claim quoted (near-)verbatim from the draft. */
  claim: string;
  /** Short reason why it contradicts the current map + where it lives today. */
  issue: string;
}

/** Injectable LLM seam so tests never hit the real gateway. */
export type NavAuditLLM = (system: string, user: string) => Promise<string>;

export interface SweepSummary {
  docsScanned: number;
  docsFlagged: number;
  deterministicPhrases: string[];
  llmClaims: string[];
  llmErrors: number;
}

// ── LLM audit prompt ─────────────────────────────────────────────────────────

export function buildNavAuditSystemPrompt(): string {
  const mapText = renderNavigationMapLines().join("\n").trim();
  return `You audit a draft BTS (Build Test Scale) member knowledge-base document for STALE PORTAL NAVIGATION. Source material predates several portal renames/relocations, so drafts can tell members to look for pages, menus or sections that no longer exist.

THE CURRENT MEMBER PORTAL NAVIGATION (authoritative — the ONLY navigation that exists today):
${mapText}

Find every claim in the draft about WHERE in the BTS member portal to find something (a page, menu, section, or click-path like "Resources > BTS Software") that CONTRADICTS the map above — i.e. names a portal location that does not exist in the map, or points members to the wrong current location.

STRICT EXCLUSIONS — never flag:
- Navigation INSIDE a tool/app (e.g. "DIYTrax > Offer Pages", "Flexy > Media Storage", menus within MetricMover, PixelPress, Gifster, ScrapeBot, CropBot). Tool-internal navigation is legitimate.
- Navigation on EXTERNAL sites (ClickBank, Media Mavens, Prime Corporate, Google, Facebook, affiliate-network dashboards, etc.).
- Locations that DO match the map (same page, even if phrased loosely).
- Lines that are already reviewer callouts (they start with "> ⚠️ NAVIGATION CONFLICT").
- General advice with no portal location claim.

Return ONLY JSON: {"findings":[{"claim":"<the stale navigation phrase, quoted as it appears in the draft>","issue":"<one sentence: why it contradicts the map and, if clear, where it lives today (current label + path)>"}]}. Return {"findings":[]} when the draft's portal navigation is consistent with the map.`;
}

/** Existing reviewer-callout lines must never be audited or re-flagged. */
export function stripNavConflictCallouts(body: string): string {
  return body
    .split("\n")
    .filter((l) => !l.includes("NAVIGATION CONFLICT (for reviewer):"))
    .join("\n");
}

export function parseNavAuditFindings(raw: string): NavAuditFinding[] {
  const parsed = JSON.parse(raw) as { findings?: unknown };
  if (!Array.isArray(parsed.findings)) return [];
  return parsed.findings
    .filter(
      (f): f is NavAuditFinding =>
        !!f &&
        typeof (f as NavAuditFinding).claim === "string" &&
        typeof (f as NavAuditFinding).issue === "string" &&
        (f as NavAuditFinding).claim.trim().length > 0 &&
        (f as NavAuditFinding).issue.trim().length > 0,
    )
    .map((f) => ({ claim: f.claim.trim(), issue: f.issue.trim() }));
}

/**
 * Append a reviewer callout for each audit finding not already flagged.
 * Idempotency key: the quoted claim inside a `navigation claim "…"` callout.
 * Returns the body unchanged when there is nothing new to flag.
 */
export function applyNavAuditFindings(body: string, findings: NavAuditFinding[]): string {
  if (findings.length === 0) return body;
  const lowerBody = body.toLowerCase();
  const seen = new Set<string>();
  const callouts: string[] = [];
  for (const f of findings) {
    const key = f.claim.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (lowerBody.includes(`navigation claim "${key}"`)) continue;
    callouts.push(
      `${NAV_CONFLICT_MARKER} navigation audit — the draft's navigation claim "${f.claim}" contradicts the current portal map: ${f.issue} Rewrite to the current name/path before publishing.`,
    );
  }
  if (callouts.length === 0) return body;
  return `${body}\n\n${callouts.join("\n")}`;
}

/**
 * Run the LLM navigation audit over one draft body. Existing callouts are
 * stripped from what the model sees so it can never flag them. Throws on LLM
 * failure — callers count the error, never fake a clean result.
 */
export async function auditDraftNavigation(
  body: string,
  llm: NavAuditLLM,
): Promise<NavAuditFinding[]> {
  const auditable = stripNavConflictCallouts(body).trim();
  if (!auditable) return [];
  const raw = await llm(buildNavAuditSystemPrompt(), `DRAFT DOCUMENT:\n${auditable}`);
  return parseNavAuditFindings(raw);
}

// ── The sweep ────────────────────────────────────────────────────────────────

/**
 * Sweep all needs_review synthesis drafts: deterministic re-screen + LLM
 * navigation audit, appending reviewer callouts only. Idempotent — safe to
 * re-run. Returns a run summary; per-doc progress goes to the logger.
 */
export async function sweepStaleNavigation(
  llm: NavAuditLLM,
  log: (msg: string) => void = console.log,
  /** Optional doc-id scope (tests use this to stay off the real review queue). */
  onlyIds?: number[],
): Promise<SweepSummary> {
  const drafts = await db
    .select({
      id: kbStagingDocsTable.id,
      title: kbStagingDocsTable.title,
      content: kbStagingDocsTable.content,
    })
    .from(kbStagingDocsTable)
    .where(
      and(
        eq(kbStagingDocsTable.status, "needs_review"),
        eq(kbStagingDocsTable.originType, "ai_synthesized"),
        eq(kbStagingDocsTable.docType, "truth_draft"),
        ...(onlyIds ? [inArray(kbStagingDocsTable.id, onlyIds)] : []),
      ),
    );

  const summary: SweepSummary = {
    docsScanned: drafts.length,
    docsFlagged: 0,
    deterministicPhrases: [],
    llmClaims: [],
    llmErrors: 0,
  };

  for (const draft of drafts) {
    const original = draft.content ?? "";

    // Pass 1: deterministic crosswalk re-screen (idempotent by construction).
    let next = applyNavigationScreen(original);
    if (next !== original) {
      const newLines = next.slice(original.length);
      const phrases = [...newLines.matchAll(/legacy portal location "([^"]+)"/g)].map((m) => m[1]);
      summary.deterministicPhrases.push(...phrases);
      log(`[sweep] doc #${draft.id} "${draft.title}": deterministic screen flagged ${phrases.join(", ") || "phrase(s)"}`);
    }

    // Pass 2: LLM navigation audit against the current map.
    try {
      const findings = await auditDraftNavigation(next, llm);
      const audited = applyNavAuditFindings(next, findings);
      if (audited !== next) {
        const newClaims = findings.map((f) => f.claim);
        summary.llmClaims.push(...newClaims);
        log(`[sweep] doc #${draft.id} "${draft.title}": LLM audit flagged ${newClaims.map((c) => `"${c}"`).join(", ")}`);
      }
      next = audited;
    } catch (err) {
      summary.llmErrors += 1;
      log(`[sweep] doc #${draft.id} "${draft.title}": LLM audit FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }

    if (next !== original) {
      await db
        .update(kbStagingDocsTable)
        .set({ content: next })
        .where(eq(kbStagingDocsTable.id, draft.id));
      summary.docsFlagged += 1;
    }
  }

  return summary;
}
