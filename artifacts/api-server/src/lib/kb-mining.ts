/**
 * KB mining gate + provenance helpers (Task #2, steps 1/11/12).
 *
 * The authoring pipeline mines training drafts from screened transcript
 * sources. This module makes that mining:
 *   - SOURCE-AWARE: only sources a human has cleared for training
 *     (kb_transcript_sources.disposition='training') are mined. Quarantined /
 *     unreviewed sources are skipped — they never reach a member-facing draft.
 *   - TAXONOMY-AWARE: each draft inherits originType + authorityRole + sourceId
 *     from its source so the reviewer (and later provenance on publish) can weigh
 *     the claim by who said it.
 *   - RE-RUNNABLE: a durable processed-record (last_mined_at) lets a re-run skip
 *     already-mined sources even after the staging queue has been cleared.
 *   - LEGACY-AWARE: detects stale legacy references (old brand / network names)
 *     so the reviewer is warned rather than silently publishing dated content.
 */

import { db } from "@workspace/db";
import { kbTranscriptSourcesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export type SourceDisposition = "training" | "quarantined";

export interface MiningSource {
  id: number;
  sourceName: string;
  sourceKind: string;
  coachName: string | null;
  disposition: string;
  authorityRole: string;
  lastMinedAt: Date | null;
}

/** Load every registered source keyed by its canonical sourceName. */
export async function loadMiningSources(): Promise<Map<string, MiningSource>> {
  const rows = await db
    .select({
      id: kbTranscriptSourcesTable.id,
      sourceName: kbTranscriptSourcesTable.sourceName,
      sourceKind: kbTranscriptSourcesTable.sourceKind,
      coachName: kbTranscriptSourcesTable.coachName,
      disposition: kbTranscriptSourcesTable.disposition,
      authorityRole: kbTranscriptSourcesTable.authorityRole,
      lastMinedAt: kbTranscriptSourcesTable.lastMinedAt,
    })
    .from(kbTranscriptSourcesTable);
  const m = new Map<string, MiningSource>();
  for (const r of rows) m.set(r.sourceName, r);
  return m;
}

export interface MiningDecision {
  /** Mine this source? */
  mine: boolean;
  /** Reason when skipping (quarantined / already-mined / unknown). */
  skipReason?: "quarantined" | "already_mined" | "unknown_source";
  source: MiningSource | null;
}

/**
 * Decide whether a source should be mined.
 *
 * Conservative by design: an unknown source (not in the registry) is NOT mined —
 * run the source population sweep first so a human disposition exists. Pass
 * `force` to re-mine an already-mined source.
 */
export function decideMining(
  sourceName: string,
  sources: Map<string, MiningSource>,
  opts: { force?: boolean } = {},
): MiningDecision {
  const source = sources.get(sourceName) ?? null;
  if (!source) return { mine: false, skipReason: "unknown_source", source: null };
  if (source.disposition !== "training") return { mine: false, skipReason: "quarantined", source };
  if (source.lastMinedAt && !opts.force) return { mine: false, skipReason: "already_mined", source };
  return { mine: true, source };
}

/** Stamp the durable processed-record so a re-run skips this source. */
export async function markSourceMined(sourceId: number): Promise<void> {
  await db
    .update(kbTranscriptSourcesTable)
    .set({ lastMinedAt: new Date() })
    .where(eq(kbTranscriptSourcesTable.id, sourceId));
}

// ── Origin facet ─────────────────────────────────────────────────────────────
// Clean origin replaces the inconsistent legacy `source` values. Derived from
// the source kind so every mined draft carries a uniform originType.

export function originTypeForKind(sourceKind: string): string {
  switch (sourceKind) {
    case "coaching_call":
      return "strategy_coaching_call";
    case "va_docx":
      return "va_call";
    case "video":
      return "training_video";
    default:
      return "ai_synthesized";
  }
}

// ── Legacy reference translation / detection ─────────────────────────────────
//
// Brand + coach scrubbing already happens in content-privacy-filter. This layer
// flags *dated content references* (old agency / network names) that a reviewer
// should refresh before publishing. We DETECT and propose, never silently
// rewrite member-facing facts.

interface LegacyRefRule {
  pattern: RegExp;
  proposed: string;
  note: string;
}

const LEGACY_REF_RULES: LegacyRefRule[] = [
  { pattern: /\bTCE\b/g, proposed: "Build Test Scale (BTS)", note: "Old program acronym" },
  { pattern: /\bCh[ae]rrington\b/gi, proposed: "the agency", note: "Legacy agency name" },
  { pattern: /\bMaxWeb\b/gi, proposed: "Media Mavens or ClickBank", note: "Removed affiliate network" },
  { pattern: /\bAffiliati\b/gi, proposed: "Media Mavens or ClickBank", note: "Removed affiliate network" },
];

export interface StaleReference {
  found: string;
  proposed: string;
  note: string;
  applied: boolean;
}

/**
 * Detect dated legacy references in a draft. Returns the list of stale refs (for
 * the staleReferences column + a review flag); does NOT mutate content.
 */
export function detectLegacyRefs(text: string): StaleReference[] {
  const out: StaleReference[] = [];
  const seen = new Set<string>();
  for (const rule of LEGACY_REF_RULES) {
    const matches = text.match(rule.pattern);
    if (!matches) continue;
    for (const found of matches) {
      const key = found.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ found, proposed: rule.proposed, note: rule.note, applied: false });
    }
  }
  return out;
}
