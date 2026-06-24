import { describe, it, expect } from "vitest";
import {
  expandVoiceQuerySynonyms,
  buildVoiceSynonymTsquery,
  VOICE_SYNONYM_GROUPS,
} from "../lib/voice-synonyms";

describe("expandVoiceQuerySynonyms", () => {
  // The four phrasings called out in the task: each must map onto the canonical
  // `refund` content term even though none of them is guaranteed to contain the
  // word "refund".
  const refundPhrasings = [
    "money back guarantee",
    "get refunded",
    "qualify for a refund",
    "do I get my money back",
  ];

  for (const phrase of refundPhrasings) {
    it(`maps "${phrase}" onto the refund term`, () => {
      expect(expandVoiceQuerySynonyms(phrase)).toContain("refund");
    });
  }

  it("matches phrasings embedded in a longer sentence", () => {
    expect(
      expandVoiceQuerySynonyms("hey can I get my money back if it doesn't work out"),
    ).toContain("refund");
  });

  it("is case- and punctuation-insensitive", () => {
    expect(expandVoiceQuerySynonyms("MONEY-BACK GUARANTEE!!!")).toContain("refund");
    expect(expandVoiceQuerySynonyms("Do I Get My Money Back?")).toContain("refund");
  });

  it("ignores accents (unaccent stand-in)", () => {
    expect(expandVoiceQuerySynonyms("réfunded")).toContain("refund");
  });

  it("returns no synonyms for unrelated queries", () => {
    expect(expandVoiceQuerySynonyms("how do affiliate commissions get paid")).toEqual([]);
    expect(expandVoiceQuerySynonyms("when is the next live coaching call")).toEqual([]);
  });

  it("returns no synonyms for empty or blank input", () => {
    expect(expandVoiceQuerySynonyms("")).toEqual([]);
    expect(expandVoiceQuerySynonyms("   ")).toEqual([]);
  });

  it("does not spuriously match on substrings of unrelated words", () => {
    // "background" contains "back" but should not trip the "money back" trigger.
    expect(expandVoiceQuerySynonyms("tell me about the program background")).toEqual([]);
  });

  it("de-duplicates canonical terms when several triggers fire at once", () => {
    const terms = expandVoiceQuerySynonyms("money back guarantee — how do I get refunded?");
    expect(terms).toEqual(["refund"]);
  });
});

describe("buildVoiceSynonymTsquery", () => {
  it("produces an OR-folded tsquery fragment for a matched phrasing", () => {
    expect(buildVoiceSynonymTsquery("do I get my money back")).toBe("refund");
  });

  it("returns an empty string when nothing matches, signalling no expansion", () => {
    expect(buildVoiceSynonymTsquery("how do I update my password")).toBe("");
  });

  it("only emits to_tsquery-safe single-word lexemes", () => {
    // Canonical terms get OR-folded straight into a to_tsquery, so they must be
    // safe single-word tokens (no spaces or punctuation that would break it).
    for (const group of VOICE_SYNONYM_GROUPS) {
      for (const term of group.canonical) {
        expect(term).toMatch(/^[a-z0-9]+$/);
      }
    }
  });
});
