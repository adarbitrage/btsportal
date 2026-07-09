import { describe, it, expect } from "vitest";
import {
  expandVoiceQuerySynonyms,
  buildVoiceSynonymTsquery,
  CONCEPT_SYNONYM_GROUPS,
} from "../lib/voice-synonyms";
import { buildConceptsDocs } from "../lib/seed-concepts-kb";

// Concepts/strategy synonym layer (extends the operations synonym mechanism in
// lib/voice-synonyms.ts). The concepts corpus uses curriculum vocabulary
// ("Headlines & Copy", "Testing Methodology") that members won't naturally
// type; these tests lock in that casual member phrasings expand onto the
// canonical lexemes the concepts docs actually carry — and, critically, that
// the new triggers do NOT fire on the known-sensitive queries (password,
// live coaching, commissions) that previously caused synonym regressions.

describe("concepts synonym expansion (positive phrasings)", () => {
  // canonical term → generous list of realistic casual member phrasings.
  const cases: Array<{ term: string; phrasings: string[] }> = [
    {
      term: "angle",
      phrasings: [
        "what makes people buy this stuff",
        "I don't get why people buy from these ads",
        "why would someone buy this product from an ad",
        "why would anyone buy this",
        "what's the reason to buy I should lead with",
        "how do I stand out from other ads",
        "is there a different ways to sell this product",
        "I need a hook for my ad",
        "help me come up with hooks for my ads",
      ],
    },
    {
      term: "headline",
      phrasings: [
        "my ads aren't getting clicks",
        "why isn't my ad getting clicks",
        "my ad is not getting clicks",
        "my campaign is not getting any clicks",
        "I'm getting no clicks at all",
        "nobody is clicking on my ad",
        "no one is clicking my ads",
        "people aren't clicking through",
        "how do I get more clicks on my ad",
        "my ad has a low click through rate",
        "what should the title of my ad say",
        "help me write a title for my ad",
      ],
    },
    {
      term: "creative",
      phrasings: [
        "what ad image works best",
        "which ad images should I run",
        "I need a good image for my ad",
        "where do I get images for my ads",
        "what picture for my ad should I choose",
        "is this a good ad picture",
        "what image should I use for my campaign",
        "which image should I use in the ad",
      ],
    },
    {
      term: "offer",
      phrasings: [
        "which product should I promote",
        "what product should I promote first",
        "what should I promote as a beginner",
        "which product should I pick to start with",
        "which product should I choose",
        "how do I pick a product",
        "help me choose a product",
        "what's a good product to promote",
        "I can't decide on a product to promote",
        "what should I sell",
      ],
    },
    {
      term: "testing",
      phrasings: [
        "how do I know if my test worked",
        "did my test work or not",
        "is my test working",
        "how do I read my test results",
        "should I run a split test",
        "how does split testing work here",
        "how do I set up an a b test",
        "what is an ab test",
        "what happens in a testing round",
        "what do I do in round one",
        "I finished round 1 what now",
        "what changes in round 2",
        "how long should I test before deciding",
        "how long should I run my test",
      ],
    },
    {
      term: "scaling",
      phrasings: [
        "when should I increase my budget",
        "can I raise my budget now",
        "should I increase the budget on this campaign",
        "is it time to raise the budget",
        "I want to add more budget",
        "should I push more budget into this",
        "should I spend more on my campaign",
        "how do I ramp up my campaign",
        "when do I scale up",
        "how do I grow my campaign safely",
      ],
    },
    {
      term: "metrics",
      phrasings: [
        "can you help me understand my numbers",
        "how do I read the numbers on my campaign",
        "am I profitable yet",
        "is my campaign profitable",
        "is this profitable or not",
        "I keep losing money on this campaign",
        "how close am I to break even",
        "am I breaking even yet",
        "what's my breakeven point",
        "what is a good cost per acquisition",
        "how do I figure out my cost per sale",
        "explain the unit economics to me",
      ],
    },
    {
      term: "placement",
      phrasings: [
        "where my ads run exactly",
        "can I control where my ads show",
        "where do my ads appear on the internet",
        "where will my ad show up",
        "I want to see where my ad shows up",
        "which traffic source should I use",
        "what traffic sources are there",
        "can I pick which sites my ads go on",
        "what are the different ad spots",
      ],
    },
  ];

  for (const { term, phrasings } of cases) {
    for (const phrase of phrasings) {
      it(`maps "${phrase}" onto the "${term}" term`, () => {
        expect(expandVoiceQuerySynonyms(phrase)).toContain(term);
      });
    }
  }

  it("maps phase/stage questions onto the testing + scaling progression", () => {
    for (const phrase of [
      "what phase am I in right now",
      "which phase am I in",
      "what phase should I be in by now",
      "when do I move to the next phase",
      "what stage am I in",
      "which stage am I in of the program",
      "what stage should I be in",
    ]) {
      const terms = expandVoiceQuerySynonyms(phrase);
      expect(terms, `phrase "${phrase}"`).toContain("testing");
      expect(terms, `phrase "${phrase}"`).toContain("scaling");
    }
  });

  it("is case- and punctuation-insensitive", () => {
    expect(expandVoiceQuerySynonyms("My Ads AREN'T Getting Clicks!!!")).toContain("headline");
    expect(expandVoiceQuerySynonyms("Which PRODUCT should I promote?")).toContain("offer");
  });
});

describe("concepts synonym expansion (negative guards)", () => {
  // The known-sensitive landmine set: these previously caused voice-synonym
  // regressions and MUST remain completely unexpanded by the new groups.
  const sensitiveQueries = [
    "how do I update my password",
    "how do I reset my password",
    "I forgot my password",
    "when is the next live coaching call",
    "what time is the live coaching session",
    "when is the next coaching call",
    "how do affiliate commissions get paid",
    "when do I get paid my commissions",
    "how do refunds work on commissions",
  ];

  for (const q of sensitiveQueries) {
    it(`does not expand concepts terms for sensitive query: "${q}"`, () => {
      const terms = expandVoiceQuerySynonyms(q);
      const conceptTerms = new Set(CONCEPT_SYNONYM_GROUPS.flatMap((g) => g.canonical));
      for (const t of terms) {
        expect(conceptTerms.has(t), `concept term "${t}" leaked for "${q}"`).toBe(false);
      }
    });
  }

  it("returns no synonyms at all for the classic landmine queries", () => {
    // Mirrors the hard assertions in voice-synonyms.test.ts — must stay empty.
    expect(expandVoiceQuerySynonyms("how do affiliate commissions get paid")).toEqual([]);
    expect(expandVoiceQuerySynonyms("when is the next live coaching call")).toEqual([]);
    expect(buildVoiceSynonymTsquery("how do I update my password")).toBe("");
  });

  const unrelatedQueries = [
    "how do I cancel a coaching session I booked",
    "where is the resource library",
    "tell me about the program background",
    "how do I change my email address",
    "what are the community rules",
  ];

  for (const q of unrelatedQueries) {
    it(`does not expand concepts terms for unrelated query: "${q}"`, () => {
      const conceptTerms = new Set(CONCEPT_SYNONYM_GROUPS.flatMap((g) => g.canonical));
      for (const t of expandVoiceQuerySynonyms(q)) {
        expect(conceptTerms.has(t), `concept term "${t}" leaked for "${q}"`).toBe(false);
      }
    });
  }
});

describe("concepts synonym groups are wired to the real corpus", () => {
  it("only emits to_tsquery-safe single-word lexemes", () => {
    for (const group of CONCEPT_SYNONYM_GROUPS) {
      for (const term of group.canonical) {
        expect(term).toMatch(/^[a-z0-9]+$/);
      }
    }
  });

  it("every canonical term actually appears in the concepts corpus", () => {
    // The synonym layer only helps if the canonical lexemes exist in the docs
    // the tsquery will run against. Guard against vocabulary drift between the
    // synonym map and the seeded corpus.
    const corpus = buildConceptsDocs()
      .map((d) => `${d.title}\n${d.content}`)
      .join("\n")
      .toLowerCase();
    for (const group of CONCEPT_SYNONYM_GROUPS) {
      for (const term of group.canonical) {
        // Stem-tolerant containment: "testing" → "testing", "scaling" →
        // "scaling", "placement" → "placements" etc. all appear literally.
        expect(
          corpus.includes(term) || corpus.includes(term.replace(/ing$/, "")),
          `canonical term "${term}" not found in the concepts corpus`,
        ).toBe(true);
      }
    }
  });

  it("no trigger contains a forbidden sensitive word", () => {
    // Static guard on the vocabulary itself (belt to the query-level braces
    // above): no concepts trigger may contain the landmine words.
    const forbidden = [/password/, /live coaching/, /coaching call/, /live call/, /commission/, /\bpaid\b/];
    for (const group of CONCEPT_SYNONYM_GROUPS) {
      for (const trigger of group.triggers) {
        for (const re of forbidden) {
          expect(re.test(trigger.toLowerCase()), `trigger "${trigger}" matches ${re}`).toBe(false);
        }
      }
    }
  });
});
