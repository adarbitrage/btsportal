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

/**
 * Concepts/strategy vocabulary (Task: concepts synonym layer). The concepts
 * home-root corpus (angles, headlines & copy, creative strategy, offer
 * strategy, testing methodology, scaling strategy, metrics & unit economics,
 * traffic & placements) uses curriculum vocabulary members won't naturally
 * type — "why isn't my ad getting clicks?" vs "Headlines & Copy". These groups
 * map casual member phrasings onto the canonical lexemes those docs actually
 * carry, exactly like the operations groups above them do for support terms.
 *
 * LANDMINE (see voice-synonyms.test.ts / kb-concepts-synonyms.test.ts): no
 * trigger here may fire on **password**, **live coaching / coaching call /
 * live call**, or **commissions / paid** — those queries must stay unexpanded.
 */
export const CONCEPT_SYNONYM_GROUPS: VoiceSynonymGroup[] = [
  {
    // "Why would anyone buy this" phrasings → the Angles doc.
    canonical: ["angle"],
    triggers: [
      "what makes people buy",
      "makes people want to buy",
      "reason to buy",
      "why would someone buy",
      "why would anyone buy",
      "why people buy",
      "how do i stand out",
      "way to sell the product",
      "different ways to sell",
      "hook for my ad",
      "hooks for my ads",
    ],
  },
  {
    // "Nobody is clicking my ad" phrasings → the Headlines & Copy doc.
    canonical: ["headline"],
    triggers: [
      "aren't getting clicks",
      "isn't getting clicks",
      "isn't my ad getting clicks",
      "ad getting clicks",
      "ads getting clicks",
      "not getting clicks",
      "not getting any clicks",
      "no clicks",
      "getting no clicks",
      "nobody is clicking",
      "no one is clicking",
      "people aren't clicking",
      "get more clicks",
      "low click through",
      "title of my ad",
      "title for my ad",
    ],
  },
  {
    // Ad image / visual phrasings → the Creative Strategy doc.
    canonical: ["creative"],
    triggers: [
      "ad image",
      "ad images",
      "image for my ad",
      "images for my ads",
      "picture for my ad",
      "pictures for my ads",
      "ad picture",
      "what image should i use",
      "which image should i use",
    ],
  },
  {
    // "Which product should I promote" phrasings → the Offer Strategy doc.
    canonical: ["offer"],
    triggers: [
      "which product should i promote",
      "what product should i promote",
      "what should i promote",
      "which product should i pick",
      "which product should i choose",
      "pick a product",
      "choose a product",
      "product to promote",
      "what should i sell",
      "good product to promote",
    ],
  },
  {
    // "Did my test work" / testing-round phrasings → the Testing Methodology doc.
    canonical: ["testing"],
    triggers: [
      "my test worked",
      "did my test work",
      "is my test working",
      "if my test worked",
      "test results",
      "split test",
      "split testing",
      "a b test",
      "ab test",
      "testing round",
      "round one",
      "round 1",
      "round 2",
      "round two",
      "how long should i test",
      "how long should i run my test",
    ],
  },
  {
    // Budget-increase phrasings → the Scaling Strategy doc.
    canonical: ["scaling"],
    triggers: [
      "increase my budget",
      "raise my budget",
      "increase the budget",
      "raise the budget",
      "add more budget",
      "push more budget",
      "spend more on my campaign",
      "ramp up my campaign",
      "scale up",
      "grow my campaign",
    ],
  },
  {
    // "Am I profitable / read my numbers" phrasings → Metrics & Unit Economics.
    canonical: ["metrics", "cpa"],
    triggers: [
      "my numbers",
      "read the numbers",
      "am i profitable",
      "is my campaign profitable",
      "is this profitable",
      "losing money",
      "break even",
      "breaking even",
      "breakeven",
      "cost per acquisition",
      "cost per sale",
      "unit economics",
    ],
  },
  {
    // "Where do my ads show up" phrasings → the Traffic & Placements doc.
    canonical: ["placement"],
    triggers: [
      "where my ads run",
      "where my ads show",
      "where do my ads appear",
      "where will my ad show",
      "where my ad shows up",
      "traffic source",
      "traffic sources",
      "which sites my ads",
      "ad spots",
    ],
  },
  {
    // "What phase/stage am I in" phrasings → the testing/scaling process docs
    // (the curriculum's build → test → scale progression).
    canonical: ["testing", "scaling"],
    triggers: [
      "what phase am i in",
      "which phase am i in",
      "what phase should i be in",
      "next phase",
      "what stage am i in",
      "which stage am i in",
      "what stage should i be in",
    ],
  },
];

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
  {
    // Membership cancellation → the cancel/billing content. Kept distinct from
    // refund: a member can cancel without it being a refund question.
    canonical: ["cancel", "cancellation"],
    triggers: [
      "cancel my membership",
      "cancel my subscription",
      "cancel my account",
      "cancel my plan",
      "stop my membership",
      "stop my subscription",
      "end my membership",
      "quit the program",
      "leave the program",
      "how do i cancel",
    ],
  },
  {
    // "Get a human / contact support" phrasings → the support routing content.
    canonical: ["support", "ticket"],
    triggers: [
      "talk to a human",
      "talk to a person",
      "speak to someone",
      "speak to a person",
      "contact support",
      "reach support",
      "get in touch with support",
      "customer service",
      "customer support",
      "help desk",
      "open a ticket",
      "raise a ticket",
      "submit a ticket",
    ],
  },
  {
    // Billing / charges → the billing content (separate from refund eligibility).
    canonical: ["billing", "charge"],
    triggers: [
      "get charged",
      "got charged",
      "double charged",
      "charged twice",
      "my invoice",
      "my receipt",
      "payment method",
      "update my card",
      "change my card",
      "billing question",
      "billing issue",
    ],
  },
  {
    // "Done-for-you" requests → the Concierge content.
    canonical: ["concierge"],
    triggers: [
      "done for you",
      "done-for-you",
      "do it for me",
      "have it done for me",
      "have the team do",
    ],
  },
  {
    // 1-on-1 / private session phrasings → the private coaching content. Avoids
    // the bare word "coaching" so it never trips the group-call schedule query.
    canonical: ["private"],
    triggers: [
      "one on one",
      "one-on-one",
      "1 on 1",
      "1-on-1",
      "one to one",
      "private session",
      "private coaching session",
      "personal coaching",
      "dedicated coach",
    ],
  },
  {
    // Ad / copy approval phrasings → the compliance review content.
    canonical: ["compliance"],
    triggers: [
      "get my ad approved",
      "ad approval",
      "approve my ad",
      "review my ad",
      "review my creative",
      "review my copy",
      "is my ad compliant",
    ],
  },
  {
    // Member community phrasings → the community content.
    canonical: ["community"],
    triggers: [
      "the forum",
      "member community",
      "member group",
      "community feed",
    ],
  },
  // Concepts/strategy vocabulary — casual phrasings → curriculum topics.
  ...CONCEPT_SYNONYM_GROUPS,
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
