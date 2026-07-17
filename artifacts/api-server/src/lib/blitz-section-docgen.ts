/**
 * Blitz section-doc generation — manifest + generator for the reference-doc
 * rebuild.
 *
 * The manifest is FIXED and computed upfront (no LLM involvement in scoping):
 * one doc per guide section, except the heavy subtopic-rich sections (7, 8, 9,
 * 19) which split into 2–3 docs at video-group boundaries. Every doc title is
 * known before any generation call. Split entries pin their transcripts by
 * EXACT video-title match against the attributed corpus — an unmatched pin or
 * an unassigned transcript in a split section throws (no silent drops).
 *
 * Generation: gpt-5 via the shared callLLMWithRetry seam. Guide text is
 * authoritative; transcripts are enrichment only. Output is plain member-facing
 * prose/markdown, capped at MAX_DOC_CHARS with one condense retry, then loud
 * failure. No fallback content, ever.
 */

import {
  BLITZ_SECTION_BY_ID,
  type BlitzSection,
} from "@workspace/blitz-curriculum";
import { BLITZ_SECTION_TO_NODE } from "./kb-taxonomy.js";
import { callLLMWithRetry } from "./kb-synthesis.js";
import {
  extractBlitzSections,
  attributeTranscripts,
  groupTranscriptsBySection,
  type TranscriptSourceInput,
  type AttributedTranscript,
  type BlitzSectionExtract,
} from "./blitz-section-extract.js";

// ── Manifest ─────────────────────────────────────────────────────────────────

/** Source tag for the new staging imports (NOT the old blitz_reference_import). */
export const BLITZ_SECTION_IMPORT_SOURCE = "blitz_section_import";

/** Hard output cap per generated doc (chars). */
export const MAX_DOC_CHARS = 8500;

const GENERATE_MAX_TOKENS = 16000;

interface RawSplit {
  /** Suffix appended to the section title (after " — "). */
  titleSuffix: string;
  /** What this part covers (steering for the generator). */
  focus: string;
  /** EXACT transcript video-title tails (the segment after the last "·"). */
  videoTitles: string[];
}

/**
 * Split definitions for the subtopic-heavy sections. Video titles must match
 * the transcript corpus exactly; buildBlitzDocManifest verifies full coverage
 * (every transcript of a split section assigned to exactly one part).
 */
export const SECTION_SPLITS: Readonly<Record<number, RawSplit[]>> = {
  7: [
    {
      titleSuffix: "Headlines and Descriptions",
      focus:
        "Writing effective native ad headlines and descriptions, including shortening headlines with macros.",
      videoTitles: ["Effective Ad Headlines", "Generate Ad Description", "Shorten Headlines Macros"],
    },
    {
      titleSuffix: "Ad Images",
      focus: "Creating native ad images with AI tools (including MidJourney).",
      videoTitles: ["Ai Generate Images", "Midjourney Images"],
    },
    {
      titleSuffix: "Preparing for Compliance",
      focus: "Preparing the finished native ad assets for compliance submission.",
      videoTitles: ["Prepare For Compliance"],
    },
  ],
  8: [
    {
      titleSuffix: "Generating Angles",
      focus: "Generating landing page angles for Media Mavens offers using the angle tools.",
      videoTitles: ["Lp Angles Affangle", "Lp Angles Affiliate Cmo"],
    },
    {
      titleSuffix: "Headlines, Copy Blocks and Hero Shots",
      focus: "Writing landing page headlines and copy blocks, and selecting hero shots.",
      videoTitles: ["Lp Headlines Copy Blocks", "Select Hero Shots"],
    },
  ],
  9: [
    {
      titleSuffix: "Capturing the VSL and Transcript",
      focus: "Downloading the offer VSL and getting a transcript from it.",
      videoTitles: ["Install Video Downloadhelper", "Download Your Vsl", "Vsl Transcript Temi"],
    },
    {
      titleSuffix: "Bridge Page Bot Copy",
      focus: "Generating bridge/jump page copy with the Bridge Page Bot.",
      videoTitles: ["Bridge Page Bot Intro", "Jump Page Copy Bridge Bot"],
    },
    {
      titleSuffix: "Choosing Page Bases",
      focus: "Choosing a jump page base and creating the landing page base copy.",
      videoTitles: ["Choose Jump Page Base", "Landing Page Base Copy"],
    },
  ],
  19: [
    {
      titleSuffix: "Creating and Cropping Videos",
      focus: "Creating videos from images, trimming them, and cropping to 9x16.",
      videoTitles: ["Create Videos From Image", "Trim Video Adobe Express", "Cropbot Crop 9x16"],
    },
    {
      titleSuffix: "Converting Videos to GIFs",
      focus: "Converting videos to GIFs and reducing GIF file size.",
      videoTitles: ["Videos To Gifs Adobe", "Videos To Gifs Ezgif", "Reduce Gif Size Gifster"],
    },
  ],
};

export interface BlitzDocManifestEntry {
  /** Stable idempotency key AND exact ai_source_documents title. */
  title: string;
  section: BlitzSection;
  /** Process node for staging (via BLITZ_SECTION_TO_NODE). */
  processNode: string;
  /** 1-based part index within the section. */
  partIndex: number;
  partCount: number;
  /** Subtopic steering for split parts; null for whole-section docs. */
  focus: string | null;
  /** Guide text (whole section — shared across parts of a split). */
  guideText: string;
  /** Transcripts feeding this doc. */
  transcripts: AttributedTranscript[];
}

function docTitle(section: BlitzSection, suffix: string | null): string {
  return suffix ? `${section.title} — ${suffix}` : section.title;
}

/**
 * Build the fixed generation manifest from the extracted sections + attributed
 * transcripts. Throws on: missing section, split video-title that matches no
 * transcript (or more than one), or a transcript in a split section that no
 * part claims. Deterministic — same corpus, same manifest.
 */
export function buildBlitzDocManifest(
  extracts: BlitzSectionExtract[],
  transcripts: TranscriptSourceInput[],
): BlitzDocManifestEntry[] {
  const attributed = attributeTranscripts(transcripts);
  const bySection = groupTranscriptsBySection(attributed);
  const entries: BlitzDocManifestEntry[] = [];

  for (const ex of extracts) {
    const sectionId = ex.section.id;
    const node = BLITZ_SECTION_TO_NODE[sectionId];
    if (!node) throw new Error(`No BLITZ_SECTION_TO_NODE entry for section ${sectionId}`);
    const sectionTranscripts = bySection.get(sectionId) ?? [];
    const splits = SECTION_SPLITS[sectionId];

    if (!splits) {
      entries.push({
        title: docTitle(ex.section, null),
        section: ex.section,
        processNode: node,
        partIndex: 1,
        partCount: 1,
        focus: null,
        guideText: ex.guideText,
        transcripts: sectionTranscripts,
      });
      continue;
    }

    const claimed = new Set<number>();
    splits.forEach((split, i) => {
      const parts: AttributedTranscript[] = [];
      for (const vt of split.videoTitles) {
        const matches = sectionTranscripts.filter((t) => t.videoTitle === vt);
        if (matches.length !== 1) {
          throw new Error(
            `Section ${sectionId} split "${split.titleSuffix}": video title "${vt}" ` +
              `matched ${matches.length} transcripts (expected exactly 1). ` +
              `Manifest and transcript corpus have drifted.`,
          );
        }
        if (claimed.has(matches[0].sourceId)) {
          throw new Error(
            `Section ${sectionId}: transcript #${matches[0].sourceId} claimed by two splits.`,
          );
        }
        claimed.add(matches[0].sourceId);
        parts.push(matches[0]);
      }
      entries.push({
        title: docTitle(ex.section, split.titleSuffix),
        section: ex.section,
        processNode: node,
        partIndex: i + 1,
        partCount: splits.length,
        focus: split.focus,
        guideText: ex.guideText,
        transcripts: parts,
      });
    });
    const unclaimed = sectionTranscripts.filter((t) => !claimed.has(t.sourceId));
    if (unclaimed.length > 0) {
      throw new Error(
        `Section ${sectionId}: ${unclaimed.length} transcript(s) not claimed by any split: ` +
          unclaimed.map((t) => `#${t.sourceId} "${t.videoTitle}"`).join(", "),
      );
    }
  }

  // Title uniqueness is the idempotency key — enforce it.
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.title)) throw new Error(`Duplicate manifest title: "${e.title}"`);
    seen.add(e.title);
  }
  return entries;
}

/** Convenience: manifest from live curriculum + provided transcripts. */
export function buildManifestFromCorpus(
  transcripts: TranscriptSourceInput[],
): BlitzDocManifestEntry[] {
  return buildBlitzDocManifest(extractBlitzSections(), transcripts);
}

// ── Generation ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a documentation writer for the BTS member portal's internal knowledge base. You write clear, accurate reference documents about The Blitz™ — the member program's step-by-step affiliate marketing system.

RULES:
- The GUIDE TEXT is the authoritative source. The VIDEO TRANSCRIPTS are enrichment only: use them for extra practical detail, tips, and clarification, but wherever they conflict with the guide text, the guide text wins.
- Write standalone member-facing reference prose in markdown (headings, short paragraphs, numbered steps, bullet lists). No preamble, no meta commentary, no "this document covers".
- Never invent tool names, URLs, prices, budget numbers, or policy details that are not in the sources.
- Refer to coaches by FIRST NAME only if any names appear. Do not include member names, emails, or phone numbers.
- Do not mention "transcripts", "videos", "lessons" or the generation process itself; write timeless reference content. You may naturally reference the Blitz guide section the content belongs to.
- Keep the whole document under ${MAX_DOC_CHARS} characters.`;

function buildUserPrompt(entry: BlitzDocManifestEntry): string {
  const s = entry.section;
  const header = [
    `DOCUMENT TITLE: ${entry.title}`,
    `BLITZ GUIDE SECTION: ${s.id} of 23 — "${s.title}" (phase: ${s.phase}, step: ${s.step}, guide anchor: ${s.sectionAnchor})`,
    entry.partCount > 1
      ? `THIS IS PART ${entry.partIndex} OF ${entry.partCount} for this section. FOCUS ONLY ON: ${entry.focus} Sibling parts cover the section's other subtopics — do not duplicate them.`
      : `This document covers the ENTIRE section.`,
  ].join("\n");

  const transcriptBlocks = entry.transcripts
    .map((t) => `--- TRANSCRIPT: ${t.videoTitle} ---\n${t.content}`)
    .join("\n\n");

  return [
    header,
    "",
    "=== GUIDE TEXT (AUTHORITATIVE) ===",
    entry.guideText,
    "",
    entry.transcripts.length > 0
      ? `=== VIDEO TRANSCRIPTS (ENRICHMENT ONLY, ${entry.transcripts.length}) ===\n${transcriptBlocks}`
      : "=== NO TRANSCRIPTS FOR THIS DOCUMENT — write from the guide text alone. ===",
    "",
    `Write the complete reference document now (markdown, under ${MAX_DOC_CHARS} characters).`,
  ].join("\n");
}

/**
 * Generate one section doc. Loud failure end-to-end: LLM errors propagate
 * (after callLLMWithRetry's bounded retries), and an over-cap result gets ONE
 * condense retry before throwing. Never returns placeholder content.
 */
export async function generateBlitzSectionDoc(
  entry: BlitzDocManifestEntry,
): Promise<string> {
  const user = buildUserPrompt(entry);
  let content = await callLLMWithRetry(
    `blitz-docgen:${entry.title}`,
    SYSTEM_PROMPT,
    user,
    GENERATE_MAX_TOKENS,
  );
  if (content.length > MAX_DOC_CHARS) {
    content = await callLLMWithRetry(
      `blitz-docgen-condense:${entry.title}`,
      SYSTEM_PROMPT,
      `The following draft of "${entry.title}" is ${content.length} characters — over the ${MAX_DOC_CHARS} hard cap. Rewrite it under the cap, preserving all steps and concrete details, trimming wordiness only.\n\n${content}`,
      GENERATE_MAX_TOKENS,
    );
  }
  if (content.length > MAX_DOC_CHARS) {
    throw new Error(
      `Generated doc "${entry.title}" is ${content.length} chars, still over the ` +
        `${MAX_DOC_CHARS} cap after a condense retry.`,
    );
  }
  if (content.length < 500) {
    throw new Error(
      `Generated doc "${entry.title}" is suspiciously short (${content.length} chars).`,
    );
  }
  return content;
}
