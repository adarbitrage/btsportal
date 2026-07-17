/**
 * Blitz written-guide figure verification.
 *
 * The 29 Blitz section docs blend two ingredient types: the WRITTEN guide
 * text (curated, authoritative) and the blitz_video transcripts (enrichment).
 * Figures that come from the written guide are curated guidelines or
 * theoretical examples and do not need the "Unverified figure" review flag;
 * figures that only exist in video-transcript material still do.
 *
 * A bare figure match is NOT enough — "$50" as a daily budget is a different
 * claim than "$50" as an ad-kill threshold. So a flagged figure is suppressed
 * only when BOTH hold:
 *   1. the exact (normalized) figure appears in the written guide, and
 *   2. the doc line's surrounding wording meaningfully overlaps the guide
 *      sentence containing that figure (shared significant tokens).
 * Anything ambiguous stays flagged — fail toward review, never toward silence.
 *
 * Pure + deterministic; the verifier is built once (lazily) from the same
 * section extractor the doc generator uses, so it always tracks the CURRENT
 * written guide.
 */

import { extractBlitzSections } from "./blitz-section-extract.js";

/** Same figure shapes kb-review-risk flags as situational_number. */
const FIGURE_PATTERNS: ReadonlyArray<RegExp> = [
  /\$\s?\d[\d,]*(?:\.\d+)?[kKmM]?\b/g,
  /\b\d[\d,]*(?:\.\d+)?\s*(?:\/|per\s+)(?:day|week|month|year|click|lead|sale)\b/gi,
  /\b\d{1,3}(?:\.\d+)?\s?%/g,
];

/** "$ 1,500 / Day" and "$1500 per day" compare equal. */
export function normalizeFigure(figure: string): string {
  return figure
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .replace(/\$\s+/, "$")
    .replace(/\s*\/\s*/, " per ")
    .trim();
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "so", "if", "then", "than", "that",
  "this", "these", "those", "it", "its", "is", "are", "was", "were", "be",
  "been", "being", "to", "of", "in", "on", "at", "for", "with", "as", "by",
  "from", "up", "down", "out", "off", "over", "under", "into", "about",
  "you", "your", "yours", "we", "our", "they", "their", "i", "me", "my",
  "he", "she", "his", "her", "will", "would", "can", "could", "should",
  "shall", "may", "might", "must", "do", "does", "did", "done", "have",
  "has", "had", "not", "no", "nor", "only", "just", "also", "very", "more",
  "most", "some", "any", "each", "all", "both", "when", "where", "how",
  "what", "which", "who", "there", "here", "get", "got", "go", "going",
  "want", "like", "make", "makes", "one", "two", "way", "thing", "things",
]);

/**
 * Significant context tokens of a sentence/line: lowercase words with the
 * figures themselves and stopwords removed (the figure must not count as its
 * own context).
 */
export function contextTokens(text: string): Set<string> {
  let s = text.toLowerCase();
  for (const re of FIGURE_PATTERNS) {
    s = s.replace(new RegExp(re.source, re.flags), " ");
  }
  const tokens = new Set<string>();
  for (const m of s.matchAll(/[a-z][a-z'-]*/g)) {
    const w = m[0].replace(/['-]+$/, "");
    if (w.length >= 2 && !STOPWORDS.has(w)) tokens.add(w);
  }
  return tokens;
}

/** Split guide plain text into sentence-ish units (bullets/lines, then . ! ?). */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    for (const part of line.split(/(?<=[.!?])\s+/)) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * Minimum context agreement: at least 2 shared significant tokens AND at
 * least half of the smaller token set shared. Tuned to separate "same
 * guideline restated" from "same number, different claim".
 */
export function contextOverlaps(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared >= 2 && shared / Math.min(a.size, b.size) >= 0.5;
}

export type BlitzFigureVerifier = (figure: string, lineText: string) => boolean;

/**
 * Build a verifier from arbitrary guide texts (exported for unit tests).
 * Returns true when the figure is corroborated IN CONTEXT by the guide.
 */
export function buildFigureVerifier(guideTexts: readonly string[]): BlitzFigureVerifier {
  // normalized figure -> context-token sets of every guide sentence containing it
  const index = new Map<string, Set<string>[]>();
  for (const text of guideTexts) {
    for (const sentence of splitSentences(text)) {
      const figures = new Set<string>();
      for (const re of FIGURE_PATTERNS) {
        for (const m of sentence.matchAll(new RegExp(re.source, re.flags))) {
          if (m[0]) figures.add(normalizeFigure(m[0]));
        }
      }
      if (figures.size === 0) continue;
      const tokens = contextTokens(sentence);
      for (const f of figures) {
        const list = index.get(f) ?? [];
        list.push(tokens);
        index.set(f, list);
      }
    }
  }
  return (figure, lineText) => {
    const candidates = index.get(normalizeFigure(figure));
    if (!candidates || candidates.length === 0) return false;
    const lineTokens = contextTokens(lineText);
    return candidates.some((guideTokens) => contextOverlaps(lineTokens, guideTokens));
  };
}

/**
 * Local mirror of blitz-section-docgen's BLITZ_SECTION_IMPORT_SOURCE — kept
 * here so the review path never imports the generation module (which pulls
 * the LLM seam). A unit test asserts the two never drift.
 */
export const BLITZ_SECTION_SOURCE = "blitz_section_import";

let cached: BlitzFigureVerifier | null = null;

/**
 * Verifier over the CURRENT written Blitz guide (all 23 sections). Lazily
 * built once per process; extraction throws loudly on guide drift, in which
 * case we deliberately do NOT suppress anything (flags stay).
 */
export function getBlitzGuideFigureVerifier(): BlitzFigureVerifier {
  if (cached) return cached;
  const sections = extractBlitzSections();
  cached = buildFigureVerifier(sections.map((s) => s.guideText));
  return cached;
}

/**
 * The verifier for a staging doc, or undefined when it does not apply:
 *  - only Blitz-section docs (source === BLITZ_SECTION_SOURCE) qualify;
 *  - if guide extraction throws (guide markup drift), we log loudly and
 *    suppress NOTHING — every figure stays flagged until the drift is fixed.
 */
export function figureVerifierForDoc(
  source: string | null | undefined,
): BlitzFigureVerifier | undefined {
  if (source !== BLITZ_SECTION_SOURCE) return undefined;
  try {
    return getBlitzGuideFigureVerifier();
  } catch (err) {
    console.error(
      "[blitz-figure-context] Guide extraction failed — figure flags NOT suppressed:",
      err,
    );
    return undefined;
  }
}
