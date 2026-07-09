/**
 * Synonym-gap proposal queue (Task #1804) — mirrors the kb-tool-tags
 * AI-proposes / human-approves pattern.
 *
 * The live retrieval synonym layer (voice-synonyms.ts) is a CODE alias map.
 * When per-doc AI analysis observes a member phrasing the map does NOT cover,
 * we record a proposal row. A human approves/rejects in the admin queue;
 * approval is a MARKER for a developer to fold the alias into the code map —
 * nothing here ever changes live retrieval.
 */

import { db } from "@workspace/db";
import { kbProposedSynonymsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { expandVoiceQuerySynonyms } from "./voice-synonyms.js";

/** Normalize a member phrasing for dedup: lowercase, single-spaced, trimmed. */
export function normalizeMemberPhrase(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Sanitize the canonical term to to_tsquery-safe word tokens. */
export function normalizeCanonicalTerm(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Should we propose this phrase at all? Only when the EXISTING code alias map
 * doesn't already expand it (i.e. a genuine coverage gap). Pure — testable.
 */
export function isSynonymGap(memberPhrase: string): boolean {
  const phrase = normalizeMemberPhrase(memberPhrase);
  if (!phrase || phrase.length < 3) return false;
  return expandVoiceQuerySynonyms(phrase).length === 0;
}

/**
 * Record (or increment) an AI-observed synonym gap. Idempotent by normalized
 * phrase: new gaps insert `pending`; repeat sightings of a still-`pending`
 * proposal bump occurrence/last-seen; approved/rejected rows are left alone
 * (a rejected phrasing won't nag). Never throws (fire-and-forget from triage).
 */
export async function recordProposedSynonym(
  memberPhrase: string,
  canonicalTerm: string,
  exampleContext?: string | null,
): Promise<void> {
  const phrase = normalizeMemberPhrase(memberPhrase);
  const canonical = normalizeCanonicalTerm(canonicalTerm);
  if (!phrase || !canonical) return;
  if (!isSynonymGap(phrase)) return; // already covered by the code alias map

  try {
    const existing = await db
      .select({ id: kbProposedSynonymsTable.id, status: kbProposedSynonymsTable.status })
      .from(kbProposedSynonymsTable)
      .where(eq(kbProposedSynonymsTable.memberPhrase, phrase))
      .limit(1);

    if (existing.length === 0) {
      await db
        .insert(kbProposedSynonymsTable)
        .values({
          memberPhrase: phrase,
          canonicalTerm: canonical,
          exampleContext: exampleContext ?? null,
        })
        .onConflictDoNothing({ target: kbProposedSynonymsTable.memberPhrase });
    } else if (existing[0].status === "pending") {
      await db
        .update(kbProposedSynonymsTable)
        .set({
          occurrenceCount: sql`${kbProposedSynonymsTable.occurrenceCount} + 1`,
          lastSeenAt: new Date(),
        })
        .where(eq(kbProposedSynonymsTable.id, existing[0].id));
    }
  } catch (err) {
    console.error("[kb-proposed-synonyms] recordProposedSynonym failed:", err);
  }
}
