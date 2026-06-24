/**
 * Synonym / alias layer for the voice knowledge-base search.
 *
 * The voice KB search is purely lexical (`websearch_to_tsquery`): a member who
 * asks "do I get my money back" only matches articles that literally contain
 * those words. Rather than editing article content every time a new phrasing is
 * discovered, this module maps common member phrasings to the canonical terms
 * the articles actually use (e.g. "money back guarantee" -> `refund`). The
 * caller OR-folds the returned canonical terms into the tsquery so the right
 * article surfaces even when the member never says the canonical word.
 *
 * Kept in code (rather than a DB table) so it is versioned, unit-testable, and
 * has zero runtime DB dependency. The matching is accent-insensitive (a JS
 * stand-in for postgres `unaccent`) and punctuation-tolerant.
 */

export interface VoiceSynonymGroup {
  /**
   * Canonical lexemes present in the KB content that these phrasings should map
   * to. These are OR-folded into the search tsquery, so they must be safe,
   * single-word `to_tsquery` tokens (lowercase, no spaces/punctuation).
   */
  canonical: string[];
  /**
   * Member-facing phrasings (substring matched against the normalized query).
   * Multi-word triggers match as contiguous phrases; single words match the
   * whole token sequence as a substring.
   */
  triggers: string[];
}

export const VOICE_SYNONYM_GROUPS: VoiceSynonymGroup[] = [
  {
    canonical: ["refund"],
    triggers: [
      "money back",
      "money-back",
      "money back guarantee",
      "get refunded",
      "getting refunded",
      "refunded",
      "reimburse",
      "reimbursed",
      "reimbursement",
      "get my money back",
      "getting my money back",
      "return my money",
      "give me my money back",
      "qualify for a refund",
      "eligible for a refund",
      "do i get my money back",
      "can i get my money back",
    ],
  },
];

/**
 * Normalize free-text for trigger matching: lowercase, strip accents (the
 * `unaccent` stand-in), collapse punctuation/whitespace to single spaces. The
 * surrounding spaces let multi-word triggers match on word boundaries.
 */
function normalizeForMatch(text: string): string {
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
 * Given a member query, return the set of canonical KB terms whose phrasings
 * appear in the query. Returns an empty array when nothing matches (the common
 * case), so the caller can skip synonym expansion entirely.
 */
export function expandVoiceQuerySynonyms(query: string): string[] {
  const haystack = normalizeForMatch(query);
  if (!haystack) return [];

  const matched = new Set<string>();
  for (const group of VOICE_SYNONYM_GROUPS) {
    const hit = group.triggers.some((trigger) => {
      const needle = normalizeForMatch(trigger);
      return needle !== "" && haystack.includes(needle);
    });
    if (hit) {
      for (const term of group.canonical) matched.add(term);
    }
  }
  return [...matched];
}

/**
 * Build a `to_tsquery`-safe OR expression from the synonym terms matched in the
 * query, e.g. `refund | reimbursement`. Returns an empty string when no synonym
 * matched, signalling the caller to leave the base query untouched.
 */
export function buildVoiceSynonymTsquery(query: string): string {
  return expandVoiceQuerySynonyms(query).join(" | ");
}
