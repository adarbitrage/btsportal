/**
 * Blitz section extraction — the deterministic input side of the section-doc
 * rebuild.
 *
 * Splits BLITZ_BODY_HTML into its 23 canonical sections using the SAME
 * mod-badge tokenizer as the video map (via getBlitzSectionHtmlSpans — single
 * parser, no drift), converts each section's HTML to clean plain text, and
 * attributes the `blitz_video` transcript sources to sections by parsing
 * their canonical "Lesson N · <section title> · <video title>" titles.
 *
 * Everything here is pure and loud: any malformed transcript title, any
 * section-title mismatch, and any out-of-range lesson id throws. There is no
 * fallback attribution.
 */

import {
  BLITZ_BODY_HTML,
  BLITZ_SECTION_BY_ID,
  BLITZ_SECTION_COUNT,
  getBlitzSectionHtmlSpans,
  type BlitzSection,
} from "@workspace/blitz-curriculum";

// ── HTML → plain text ────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&rsquo;": "\u2019",
  "&lsquo;": "\u2018",
  "&rdquo;": "\u201d",
  "&ldquo;": "\u201c",
  "&trade;": "™",
  "&copy;": "©",
  "&reg;": "®",
  "&times;": "×",
  "&rarr;": "→",
  "&larr;": "←",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-zA-Z]+;/g, (m) => ENTITIES[m] ?? m);
}

/**
 * Convert a section's HTML fragment to readable plain text: block elements
 * become paragraph/line breaks, list items become "- " bullets, headings are
 * kept on their own lines, all other tags are stripped, entities decoded and
 * whitespace normalized. Deterministic — same input, same output.
 */
export function blitzSectionHtmlToText(html: string): string {
  let s = html;
  // Drop non-content subtrees entirely.
  s = s.replace(/<(script|style|svg|iframe)\b[\s\S]*?<\/\1>/gi, " ");
  // Line-break-ish tags.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // List items → bullets.
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  // Block-level open/close tags → newlines (double for paragraph-ish blocks).
  s = s.replace(/<\/(p|div|section|article|blockquote|tr|table|ul|ol|h[1-6])>/gi, "\n\n");
  s = s.replace(/<(p|div|section|article|blockquote|h[1-6])\b[^>]*>/gi, "\n");
  // Table cells → separator.
  s = s.replace(/<\/(td|th)>/gi, " | ");
  // Everything else stripped.
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  // Whitespace normalization: collapse intra-line runs, trim lines, collapse
  // 3+ newlines to a blank line.
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

// ── Section extraction ───────────────────────────────────────────────────────

export interface BlitzSectionExtract {
  /** Canonical curriculum metadata for the section. */
  section: BlitzSection;
  /** The section's guide content as clean plain text. */
  guideText: string;
  /** Raw HTML span (for debugging / char accounting). */
  htmlLength: number;
}

/** Split the guide into its 23 sections as clean text. Throws on any drift. */
export function extractBlitzSections(): BlitzSectionExtract[] {
  const spans = getBlitzSectionHtmlSpans();
  return spans.map((span) => {
    const section = BLITZ_SECTION_BY_ID[span.id];
    if (!section) throw new Error(`No BLITZ_SECTION_BY_ID entry for section ${span.id}`);
    const html = BLITZ_BODY_HTML.slice(span.start, span.end);
    const guideText = blitzSectionHtmlToText(html);
    if (guideText.length < 40) {
      throw new Error(
        `Section ${span.id} ("${section.title}") extracted to suspiciously short text ` +
          `(${guideText.length} chars) — guide markup likely changed.`,
      );
    }
    return { section, guideText, htmlLength: html.length };
  });
}

// ── Transcript attribution ───────────────────────────────────────────────────

export interface TranscriptSourceInput {
  id: number;
  title: string;
  content: string;
}

export interface AttributedTranscript {
  sourceId: number;
  sectionId: number;
  /** The video-specific tail of the transcript title. */
  videoTitle: string;
  content: string;
}

// "Lesson N · <section title> · <video title>" — the canonical blitz_video
// source-title format. The middle segment may itself contain "·"-free em/en
// dashes but never the "·" separator, so a 3-way split on "·" is safe; if a
// title ever has more separators we join the tail back for the video title.
const TRANSCRIPT_TITLE_RE = /^Lesson\s+(\d{1,3})\s*·\s*(.+)$/;

function normalizeTitle(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Attribute each blitz_video transcript to its canonical section by parsing
 * the "Lesson N · <section title> · <video title>" title. HARD FAILS (throws)
 * on: unparseable title, lesson id outside 1..23, or a section-title segment
 * that does not exactly match the canonical BLITZ_SECTION_BY_ID title —
 * mismatches mean the transcript corpus and the curriculum have drifted and
 * must be reconciled by a human, never silently guessed.
 */
export function attributeTranscripts(
  transcripts: TranscriptSourceInput[],
): AttributedTranscript[] {
  return transcripts.map((t) => {
    const m = t.title.match(TRANSCRIPT_TITLE_RE);
    if (!m) {
      throw new Error(
        `Transcript #${t.id} title does not match "Lesson N · …" format: "${t.title}"`,
      );
    }
    const sectionId = Number(m[1]);
    if (sectionId < 1 || sectionId > BLITZ_SECTION_COUNT) {
      throw new Error(
        `Transcript #${t.id} claims lesson ${sectionId} (out of 1..${BLITZ_SECTION_COUNT}): "${t.title}"`,
      );
    }
    const rest = m[2].split("·").map((p) => p.trim());
    if (rest.length < 2) {
      throw new Error(
        `Transcript #${t.id} title has no video segment (expected "Lesson N · section · video"): "${t.title}"`,
      );
    }
    const sectionTitle = rest[0];
    const videoTitle = rest.slice(1).join(" · ");
    const canonical = BLITZ_SECTION_BY_ID[sectionId];
    if (normalizeTitle(sectionTitle) !== normalizeTitle(canonical.title)) {
      throw new Error(
        `Transcript #${t.id} section-title mismatch for lesson ${sectionId}: ` +
          `title says "${sectionTitle}" but canonical is "${canonical.title}". ` +
          `Reconcile the transcript corpus with the curriculum before regenerating docs.`,
      );
    }
    return { sourceId: t.id, sectionId, videoTitle, content: t.content };
  });
}

/** Group attributed transcripts by section id (document order preserved). */
export function groupTranscriptsBySection(
  attributed: AttributedTranscript[],
): Map<number, AttributedTranscript[]> {
  const bySection = new Map<number, AttributedTranscript[]>();
  for (const t of attributed) {
    const list = bySection.get(t.sectionId) ?? [];
    list.push(t);
    bySection.set(t.sectionId, list);
  }
  return bySection;
}
