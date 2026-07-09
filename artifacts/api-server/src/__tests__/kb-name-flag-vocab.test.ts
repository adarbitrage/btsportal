/**
 * Task #1815 — self-maintaining name-flag vocabulary. Tests the PURE assembly
 * (buildNameFlagVocab + extractCapitalizedPairs); the DB-reading refresh path
 * is a thin wrapper over these.
 */
import { describe, it, expect } from "vitest";
import { buildNameFlagVocab, extractCapitalizedPairs, NAME_PAIR_DOC_THRESHOLD } from "../lib/kb-name-flag-vocab";
import { analyzeDraftForReview } from "../lib/kb-review-risk";

const EMPTY = {
  authoritativeWords: [] as string[],
  terminologyPhrases: [] as string[],
  docTitles: [] as string[],
  corpusPairs: [] as string[],
  dismissedPairs: [] as string[],
};

describe("extractCapitalizedPairs", () => {
  it("extracts lowercased First Last shaped pairs only", () => {
    const pairs = extractCapitalizedPairs("Use the Advertorial Builder; ask Marcus Delgado. AI stuff.");
    expect(pairs.has("advertorial builder")).toBe(true);
    expect(pairs.has("marcus delgado")).toBe(true);
    expect(pairs.size).toBe(2);
  });
});

describe("buildNameFlagVocab", () => {
  it("always includes the hand-verified seed pairs", () => {
    const v = buildNameFlagVocab(EMPTY);
    expect(v.phrases.has("unit economics")).toBe(true);
    expect(v.words.size).toBe(0);
  });

  it("routes authoritative single words to words, multi-word to phrases", () => {
    const v = buildNameFlagVocab({ ...EMPTY, authoritativeWords: ["Flexy", "Media Mavens"] });
    expect(v.words.has("flexy")).toBe(true);
    expect(v.phrases.has("media mavens")).toBe(true);
    expect(v.words.has("media mavens")).toBe(false);
  });

  it("glossary terms: only multi-word phrases, never word-level suppression", () => {
    const v = buildNameFlagVocab({ ...EMPTY, terminologyPhrases: ["Landing Page", "Angle"] });
    expect(v.phrases.has("landing page")).toBe(true);
    expect(v.words.has("angle")).toBe(false);
  });

  it("extracts pairs from doc titles and folds in corpus + dismissed pairs", () => {
    const v = buildNameFlagVocab({
      ...EMPTY,
      docTitles: ["How the Advertorial Builder Works"],
      corpusPairs: ["pixel boost"],
      dismissedPairs: ["consumer watchdog"],
    });
    expect(v.phrases.has("advertorial builder")).toBe(true);
    expect(v.phrases.has("pixel boost")).toBe(true);
    expect(v.phrases.has("consumer watchdog")).toBe(true);
  });

  it("privacy rail: privacy-protected pairs never enter the vocabulary", () => {
    const v = buildNameFlagVocab({
      ...EMPTY,
      authoritativeWords: ["Clark"],
      corpusPairs: ["bruce clark"],
      dismissedPairs: ["bruce clark"],
      docTitles: ["Notes from Bruce Clark"],
    });
    expect(v.phrases.has("bruce clark")).toBe(false);
    expect(v.words.has("clark")).toBe(false);
  });

  it("threshold constant is conservative (>= 4 distinct docs)", () => {
    expect(NAME_PAIR_DOC_THRESHOLD).toBeGreaterThanOrEqual(4);
  });

  it("tool-tag triggers are phrase-only: single-word triggers (e.g. 'claude') never become word suppression, so 'Claude Robinson' still flags", () => {
    // Mirrors the refresh path: tool-tag slugs + triggers go through
    // terminologyPhrases, never authoritativeWords.
    const toolTriggers = ["claude", "chatgpt", "claude code", "facebook ads manager"];
    const v = buildNameFlagVocab({ ...EMPTY, terminologyPhrases: toolTriggers });
    expect(v.words.has("claude")).toBe(false);
    expect(v.words.has("chatgpt")).toBe(false);
    expect(v.phrases.has("claude code")).toBe(true);
    expect(
      analyzeDraftForReview("A member asked claude Robinson's question. Claude Robinson wrote in.", v).some(
        (h) => h.kind === "possible_member_name",
      ),
    ).toBe(true);
  });
});
