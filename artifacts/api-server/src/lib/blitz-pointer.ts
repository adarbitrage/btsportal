/**
 * Blitz guide pointer — the "guide members to the Blitz first" retrieval layer.
 *
 * Two layers feed the chat prompt:
 *
 *  Layer 1 (exact anchor): live KB docs authored from the Blitz guide carry a
 *  `blitz_section` anchor (1–23, matching @workspace/blitz-curriculum
 *  BLITZ_SECTION_BY_ID). When a retrieved doc has one, the chat route injects
 *  the member-visible section reference so the model can point precisely.
 *
 *  Layer 2 (fuzzy match): when KB retrieval has no confident answer, the
 *  member's question is matched lexically against the published Blitz lesson
 *  library (blitz_lessons). Matched lessons are mapped to guide sections via
 *  the live video map (source_video_id → guide placement), falling back to a
 *  keyword overlap against the canonical section titles. Results are advisory
 *  candidates — the prompt labels them unverified and the model must hedge
 *  ("likely covered in…").
 *
 * All references are TEXTUAL (phase + section title + video titles) — never
 * links and never internal lesson numbers, per prompt Rules 12/15.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  BLITZ_SECTION_BY_ID,
  BLITZ_PHASE_MAP,
  BLITZ_SECTIONS,
  getBlitzVideoMap,
} from "@workspace/blitz-curriculum";

/** Member-visible textual reference for a Blitz guide section. */
export function formatBlitzSectionRef(sectionId: number): string | null {
  const section = BLITZ_SECTION_BY_ID[sectionId];
  if (!section) return null;
  const phase = BLITZ_PHASE_MAP[section.phase];
  return `the "${section.title}" section (${phase.label}) of the Blitz guide`;
}

/** Titles of the videos embedded in a Blitz guide section (member-visible). */
export function getSectionVideoTitles(sectionId: number): string[] {
  const placements = getBlitzVideoMap().byLesson.get(sectionId) ?? [];
  const titles: string[] = [];
  for (const p of placements) {
    const t = p.title?.trim();
    if (t && !titles.includes(t)) titles.push(t);
  }
  return titles;
}

/** One pointer candidate for the prompt block. */
export interface BlitzPointerCandidate {
  sectionId: number;
  /** e.g. `the "Set Up DIYTrax" section (Phase 1 — Build) of the Blitz guide` */
  reference: string;
  /** Member-visible titles of the videos on that part of the guide page. */
  videoTitles: string[];
}

function toCandidate(sectionId: number): BlitzPointerCandidate | null {
  const reference = formatBlitzSectionRef(sectionId);
  if (!reference) return null;
  return { sectionId, reference, videoTitles: getSectionVideoTitles(sectionId) };
}

/** Build candidates from explicit section anchors (Layer 1), deduped, in order. */
export function candidatesFromAnchors(sectionIds: Array<number | null | undefined>): BlitzPointerCandidate[] {
  const out: BlitzPointerCandidate[] = [];
  for (const id of sectionIds) {
    if (typeof id !== "number") continue;
    if (out.some((c) => c.sectionId === id)) continue;
    const c = toCandidate(id);
    if (c) out.push(c);
  }
  return out;
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "be", "in", "on", "at", "of", "to",
  "for", "and", "or", "what", "how", "do", "does", "i", "my", "me", "you",
  "it", "its", "this", "that", "with", "about", "tell", "can", "where",
  "find", "area", "tab", "section", "page", "help", "please", "blitz",
]);

/** Query words worth matching (lowercased, stopwords and short tokens dropped). */
export function significantWords(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s&™-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
    ),
  );
}

/**
 * Layer 2: find the Blitz guide sections most likely to cover a question.
 * Never throws — a pointer is advisory, so failures degrade to [].
 */
export async function findLikelyBlitzSections(
  query: string,
  limit = 2,
): Promise<BlitzPointerCandidate[]> {
  const words = significantWords(query);
  if (words.length === 0) return [];

  const sectionIds: number[] = [];

  // Primary: lexical rank over the published lesson library, mapped to guide
  // sections through the live video map (a lesson's video appears at a known
  // spot in the guide page).
  try {
    const tsquery = words.map((w) => w.replace(/[^a-z0-9]/g, "")).filter(Boolean).join(" | ");
    if (tsquery.length > 0) {
      const result = await db.execute(sql`
        SELECT source_video_id,
               ts_rank(to_tsvector('english', title || ' ' || content), to_tsquery('english', ${tsquery})) AS rank
        FROM blitz_lessons
        WHERE status = 'published'
          AND source_video_id IS NOT NULL AND source_video_id <> ''
          AND to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${tsquery})
        ORDER BY rank DESC
        LIMIT 8
      `);
      const videoMap = getBlitzVideoMap();
      for (const row of result.rows as Array<{ source_video_id: string }>) {
        const info = videoMap.byVideoId.get(row.source_video_id);
        for (const lesson of info?.lessons ?? []) {
          if (!sectionIds.includes(lesson)) sectionIds.push(lesson);
        }
      }
    }
  } catch {
    // Advisory only — fall through to the title-overlap fallback.
  }

  // Fallback: keyword overlap against the canonical section titles/steps.
  if (sectionIds.length === 0) {
    const scored = BLITZ_SECTIONS.map((s) => {
      const haystack = `${s.title} ${s.step}`.toLowerCase();
      const hits = words.filter((w) => haystack.includes(w)).length;
      return { id: s.id, hits };
    })
      .filter((s) => s.hits > 0)
      .sort((a, b) => b.hits - a.hits);
    for (const s of scored) {
      if (!sectionIds.includes(s.id)) sectionIds.push(s.id);
    }
  }

  return sectionIds
    .slice(0, limit)
    .map(toCandidate)
    .filter((c): c is BlitzPointerCandidate => c !== null);
}

function renderCandidate(c: BlitzPointerCandidate): string {
  const videos =
    c.videoTitles.length > 0
      ? `\n  Videos on that part of the guide page: ${c.videoTitles.map((t) => `"${t}"`).join(", ")}`
      : "";
  return `- ${c.reference}${videos}`;
}

/**
 * Prompt block for the CONFIDENT branch: where the provided articles live in
 * the Blitz guide, so the model can name the section (and, when the member
 * says they can't find it, the specific video on that part of the page).
 */
export function buildAnchoredBlitzBlock(candidates: BlitzPointerCandidate[]): string {
  if (candidates.length === 0) return "";
  return (
    `\n\n## Blitz Guide Locations for the Articles Above\n\n` +
    `The knowledge base articles provided above were authored from these parts of the Blitz guide. ` +
    `When helpful — and always when the member says they can't find something — point them there ` +
    `textually per Rule 12 (never as a link, never with internal lesson numbers):\n\n` +
    candidates.map(renderCandidate).join("\n")
  );
}

/**
 * Prompt block for the NON-confident branch: unverified best-guess sections
 * for the Blitz-first fallback ladder (Rule 12, step 1).
 */
export function buildFuzzyBlitzBlock(candidates: BlitzPointerCandidate[]): string {
  if (candidates.length === 0) return "";
  return (
    `\n\n## Possibly Relevant Blitz Guide Sections (unverified)\n\n` +
    `These sections of the Blitz guide MAY cover the member's question — they matched the question's ` +
    `wording against the Blitz training content, but the match is NOT verified. Use them ONLY for the ` +
    `Rule 12 Blitz-first pointer, with hedged wording ("this is likely covered in…"). Do not present ` +
    `their existence as a verified answer to the question itself:\n\n` +
    candidates.map(renderCandidate).join("\n")
  );
}
