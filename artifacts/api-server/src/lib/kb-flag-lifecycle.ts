/**
 * KB review flag lifecycle (Task #1906).
 *
 * Reviewer decisions about risk flags and passage highlights must SURVIVE
 * re-analysis / re-synthesis instead of resurrecting on every run:
 *
 *  - Passage highlights (kb-review-risk) get a persistent "Ignore" keyed on
 *    (kind + normalized excerpt) — global across drafts, so a future synthesis
 *    run reproducing the identical passage stays dismissed.
 *  - Doc-level risk flags (kb-flags) get Resolve/Ignore rows pinned to the
 *    flag's FINGERPRINT (normalized message+detail). Deterministic re-triage
 *    that reproduces the same flag stays resolved; a flag re-appearing with a
 *    NEW trigger (different fingerprint) resurfaces for fresh adjudication.
 *
 * The stored `riskFlags` column always keeps the FULL computed set — active
 * filtering happens at read/gate time so the audit picture is never lossy.
 *
 * Pure helpers (normalization, fingerprinting, partitioning) live at the top;
 * the DB-backed helpers below do the per-doc reads + the deterministic
 * re-triage that runs after content edits.
 */

import { db } from "@workspace/db";
import {
  kbStagingDocsTable,
  kbHighlightDismissalsTable,
  kbFlagResolutionsTable,
  type KbHighlightDismissal,
  type KbFlagResolution,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  computeRiskFlags,
  gatherFlagContext,
  computeRetrievalSelfTestFlag,
  maxSeverity,
  type RiskFlag,
} from "./kb-flags.js";
import { analyzeDraftForReview, type ReviewHighlight } from "./kb-review-risk.js";
import { isCitableDocClass } from "./kb-taxonomy.js";

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Lowercase + collapse whitespace: the cross-doc highlight suppression key. */
export function normalizeExcerpt(excerpt: string): string {
  return excerpt.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Stable identity of a flag's TRIGGER. A resolution only covers a recomputed
 * flag when the fingerprint matches — same type with new message/detail is a
 * new trigger and must resurface.
 */
export function flagFingerprint(flag: Pick<RiskFlag, "type" | "message" | "detail">): string {
  return normalizeExcerpt(`${flag.type}|${flag.message}|${flag.detail ?? ""}`);
}

export interface FlagState {
  flag: RiskFlag;
  resolved: boolean;
  resolution: {
    id: number;
    reason: string | null;
    resolvedBy: number | null;
    resolvedAt: string;
  } | null;
}

/**
 * Partition stored flags into active vs resolved using the resolution rows.
 * Resolution matches on (flagType + fingerprint) — pure and unit-testable.
 */
export function partitionFlags(
  flags: readonly RiskFlag[],
  resolutions: readonly Pick<KbFlagResolution, "id" | "flagType" | "fingerprint" | "reason" | "resolvedBy" | "createdAt">[],
): { states: FlagState[]; active: RiskFlag[] } {
  const byType = new Map(resolutions.map((r) => [r.flagType, r]));
  const states: FlagState[] = flags.map((flag) => {
    const r = byType.get(flag.type);
    const resolved = !!r && r.fingerprint === flagFingerprint(flag);
    return {
      flag,
      resolved,
      resolution:
        resolved && r
          ? {
              id: r.id,
              reason: r.reason,
              resolvedBy: r.resolvedBy,
              resolvedAt:
                r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
            }
          : null,
    };
  });
  return { states, active: states.filter((s) => !s.resolved).map((s) => s.flag) };
}

/**
 * Partition analyzed highlights into active vs dismissed using the global
 * dismissal vocabulary (kind + normalized excerpt). Pure.
 */
export function partitionHighlights(
  highlights: readonly ReviewHighlight[],
  dismissals: readonly Pick<KbHighlightDismissal, "id" | "kind" | "excerptNorm">[],
): {
  active: ReviewHighlight[];
  dismissed: Array<ReviewHighlight & { dismissalId: number }>;
} {
  const byKey = new Map(dismissals.map((d) => [`${d.kind}|${d.excerptNorm}`, d.id]));
  const active: ReviewHighlight[] = [];
  const dismissed: Array<ReviewHighlight & { dismissalId: number }> = [];
  for (const h of highlights) {
    const id = byKey.get(`${h.kind}|${normalizeExcerpt(h.excerpt)}`);
    if (id != null) dismissed.push({ ...h, dismissalId: id });
    else active.push(h);
  }
  return { active, dismissed };
}

// ── DB-backed helpers ────────────────────────────────────────────────────────

type StagingDocRow = typeof kbStagingDocsTable.$inferSelect;

export interface DocOutstanding {
  activeFlags: RiskFlag[];
  activeHighlights: ReviewHighlight[];
  flagStates: FlagState[];
  dismissedHighlights: Array<ReviewHighlight & { dismissalId: number }>;
}

/**
 * Everything the approval gate (and review-insights) needs for one doc:
 * active vs resolved flags, active vs dismissed highlights, computed from the
 * doc's CURRENT text. `contentOverride` lets the PATCH gate judge the text
 * that is ABOUT to be saved.
 */
export async function getDocOutstanding(
  doc: Pick<StagingDocRow, "id" | "riskFlags" | "editedContent" | "content">,
  contentOverride?: string,
): Promise<DocOutstanding> {
  const [resolutions, dismissals] = await Promise.all([
    db.select().from(kbFlagResolutionsTable).where(eq(kbFlagResolutionsTable.stagingDocId, doc.id)),
    db.select().from(kbHighlightDismissalsTable),
  ]);
  const flags = Array.isArray(doc.riskFlags) ? (doc.riskFlags as RiskFlag[]) : [];
  const { states, active } = partitionFlags(flags, resolutions);
  const highlights = analyzeDraftForReview(
    contentOverride ?? doc.editedContent ?? doc.content,
  );
  const parts = partitionHighlights(highlights, dismissals);
  return {
    activeFlags: active,
    activeHighlights: parts.active,
    flagStates: states,
    dismissedHighlights: parts.dismissed,
  };
}

/**
 * Recompute needsExpert from the doc's stored flags minus its resolutions
 * (a resolved critical no longer demands the expert track) and persist it.
 * Mirrors triage's rule: needsExpert = an ACTIVE critical flag exists.
 */
export async function recomputeNeedsExpert(docId: number): Promise<boolean> {
  const [doc] = await db
    .select({ id: kbStagingDocsTable.id, riskFlags: kbStagingDocsTable.riskFlags })
    .from(kbStagingDocsTable)
    .where(eq(kbStagingDocsTable.id, docId));
  if (!doc) return false;
  const resolutions = await db
    .select()
    .from(kbFlagResolutionsTable)
    .where(eq(kbFlagResolutionsTable.stagingDocId, docId));
  const flags = Array.isArray(doc.riskFlags) ? (doc.riskFlags as RiskFlag[]) : [];
  const { active } = partitionFlags(flags, resolutions);
  const needsExpert = maxSeverity(active) === "critical";
  await db
    .update(kbStagingDocsTable)
    .set({ needsExpert })
    .where(eq(kbStagingDocsTable.id, docId));
  return needsExpert;
}

/**
 * Deterministic re-triage after a content edit (manual PATCH of editedContent,
 * refine patch/rewrite, per-passage cut). Recomputes the stored riskFlags from
 * the CURRENT text via the same pure computeRiskFlags used by AI triage — no
 * LLM call — so a flag whose trigger the reviewer edited away disappears, and
 * a RESOLVED flag whose trigger is unchanged is NOT resurrected (its stored
 * fingerprint still matches).
 *
 * Preserved verbatim from the previous flag set (they are not derivable from
 * content alone):
 *  - navigation_drift (appended by the boot-time nav drift scan);
 * Recomputed from stored companion data:
 *  - retrieval_gap (from the stored self-test result);
 *  - non_citable_review_doc (from the filed doc class).
 */
export async function retriageDocFlags(docId: number): Promise<void> {
  const [doc] = await db
    .select()
    .from(kbStagingDocsTable)
    .where(eq(kbStagingDocsTable.id, docId));
  if (!doc) return;

  const content = doc.editedContent ?? doc.content;
  const ctx = await gatherFlagContext({ title: doc.title, aiCleanedTitle: doc.aiCleanedTitle });

  const suggested = (doc.aiSuggestedTaxonomy ?? null) as {
    homeRoot?: string | null;
    node?: string | null;
    docClass?: string | null;
  } | null;

  const flags = computeRiskFlags({
    title: doc.title,
    content,
    authorityRole: doc.authorityRole,
    docClassTarget: doc.docClassTarget ?? suggested?.docClass ?? null,
    homeRoot: doc.homeRoot ?? suggested?.homeRoot ?? null,
    node: doc.node ?? suggested?.node ?? null,
    corroborationCount: doc.corroborationCount ?? 0,
    duplicateTitle: ctx.duplicateTitle,
    conflictsWithVerified: ctx.conflictsWithVerified,
  });

  // Citeable-only pipeline (Task #1873) — mirror of triage's warning.
  if (doc.docClassTarget != null && !isCitableDocClass(doc.docClassTarget)) {
    flags.push({
      type: "non_citable_review_doc",
      severity: "high",
      message: "Filed under a non-citeable class — review docs must be citeable",
      detail: `This review doc is filed as "${doc.docClassTarget}", which is never surfaced to members. Re-file it as a citeable class (curated / overview / navigation) so it can be published and cited.`,
    });
  }

  // Retrieval self-test flag from the STORED result (self-tests only run in
  // full AI analysis; a text edit alone must not drop the known gap).
  const selfTestFlag = computeRetrievalSelfTestFlag(
    doc.retrievalSelfTest as { results: Array<{ question: string; passed: boolean }> } | null,
  );
  if (selfTestFlag) flags.push(selfTestFlag);

  // Carry over flags that content-only recomputation cannot reproduce.
  const previous = Array.isArray(doc.riskFlags) ? (doc.riskFlags as RiskFlag[]) : [];
  for (const f of previous) {
    if (f.type === "navigation_drift") flags.push(f);
  }

  const resolutions = await db
    .select()
    .from(kbFlagResolutionsTable)
    .where(eq(kbFlagResolutionsTable.stagingDocId, docId));
  const { active } = partitionFlags(flags, resolutions);
  const conflictFlag = flags.find((f) => f.type === "conflict");

  await db
    .update(kbStagingDocsTable)
    .set({
      riskFlags: flags,
      needsExpert: maxSeverity(active) === "critical",
      conflictData: conflictFlag
        ? { message: conflictFlag.message, detail: conflictFlag.detail }
        : null,
    })
    .where(eq(kbStagingDocsTable.id, docId));
}
