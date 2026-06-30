import {
  BLITZ_SECTION_BY_ID,
  getKnownVidalyticsIds,
  getBlitzLessonsForVideo,
} from "@workspace/blitz-curriculum";

/**
 * Blitz caption-filename recognizer.
 *
 * Admins bulk-upload caption/transcript files for the Blitz lesson videos into
 * the Transcript Cleaner. Each file follows a strict naming convention that
 * encodes the lesson, the video's order within that lesson, a human-readable
 * topic slug, and the source Vidalytics video id:
 *
 *   blitz-lesson{NN}-{vv}-{slug}__{vidalyticsId}.vtt
 *   e.g. blitz-lesson11-01-clone-flexy-website__sJ7NhNU9POi7DpXV.vtt
 *
 * When a filename matches, the intake fields are auto-filled so the file lands
 * correctly categorized with zero manual cleanup. The lesson number is resolved
 * to its canonical Blitz lesson title via the shared curriculum package so the
 * title matches what is shown on the Blitz page; an out-of-range / unknown
 * lesson number falls back gracefully (no curriculum title) instead of erroring.
 * Placeholder ids (e.g. VIDEO_ID_004) parse fine too — the provenance note just
 * records the placeholder so it can be corrected later.
 *
 * Files that do NOT match the convention return `null`, so the caller keeps the
 * existing behavior (raw filename as source, no auto type).
 */

export interface BlitzCaptionMeta {
  /** Lesson number parsed from the filename ({NN}). */
  lessonNumber: number;
  /** The video's 1-based order within its lesson ({vv}). */
  inLessonOrder: number;
  /** The raw topic slug ({slug}). */
  slug: string;
  /** The source Vidalytics video id — safety-net cleaned (see sanitize below). */
  vidalyticsId: string;
  /** The raw id captured from the filename, before safety-net cleaning. */
  rawVidalyticsId: string;
  /**
   * Every Blitz lesson this video appears in, derived LIVE from the guide via
   * the Vidalytics id. Empty when the id isn't (yet) referenced in the guide
   * (e.g. a placeholder id), in which case the parsed {NN} stands alone.
   */
  lessons: number[];
  /** Canonical Blitz lesson title when {NN} resolves, else null. */
  lessonTitle: string | null;
  /** Derived clean, human-readable document title. */
  title: string;
  /** Destination folder slug — always "blitz_video". */
  transcriptType: "blitz_video";
  /** Provenance note capturing the Vidalytics id + lesson reference. */
  provenanceNote: string;
}

/**
 * Safety net for the captured Vidalytics id.
 *
 * Real Vidalytics ids are a fixed alphanumeric+underscore token (no spaces, no
 * punctuation). Filenames that pass through OS / upload tooling get mangled —
 * spaces substituted for underscores, parentheticals appended, an upload
 * timestamp tacked on (`__id_1782858624128`), etc. — which would otherwise
 * corrupt the captured id. We reconcile the captured token against the set of
 * ids the Blitz guide actually references (derived live), so a dirty filename
 * still resolves to the exact clean id whenever the real id is recoverable:
 *
 *   1. exact match -> use it.
 *   2. spaces -> underscores, then exact match.
 *   3. longest known id that is a prefix of the (normalized) token -> use it
 *      (handles appended timestamps / parentheticals / truncated trailing junk).
 *   4. otherwise fall back to the leading [A-Za-z0-9_] run (best effort), so a
 *      brand-new id not yet in the guide is still captured cleanly.
 */
export function sanitizeVidalyticsId(raw: string): string {
  const known = getKnownVidalyticsIds();
  const trimmed = raw.trim();
  if (known.has(trimmed)) return trimmed;

  const normalized = trimmed.replace(/\s+/g, "_");
  if (known.has(normalized)) return normalized;

  // Longest known id that the token starts with wins (random 16-char ids make
  // a shorter-id false prefix effectively impossible, but prefer the longest).
  let best: string | null = null;
  for (const id of known) {
    if (normalized.startsWith(id) && (!best || id.length > best.length)) best = id;
  }
  if (best) return best;

  // Unknown id: keep the leading id-shaped run, dropping any trailing junk.
  const m = normalized.match(/^[A-Za-z0-9_]+/);
  return m ? m[0] : normalized;
}

// blitz-lesson{NN}-{vv}-{slug}__{vidalyticsId}[.ext]
// - {NN}/{vv}: 1-3 digits. {slug}: anything up to the `__` separator (slugs use
//   hyphens, never `__`). {vidalyticsId}: no path / extension chars (so it stops
//   before the optional extension's dot). Case-insensitive on the literal prefix.
const BLITZ_CAPTION_RE =
  /^blitz-lesson(\d{1,3})-(\d{1,3})-(.+?)__([^./\\]+)(?:\.[A-Za-z0-9]+)?$/i;

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function parseBlitzCaptionFilename(filename: unknown): BlitzCaptionMeta | null {
  if (typeof filename !== "string") return null;
  // Strip any leading directory path so a/b/blitz-lesson… still matches.
  const base = (filename.trim().split(/[/\\]/).pop() ?? "").trim();
  const m = base.match(BLITZ_CAPTION_RE);
  if (!m) return null;

  const lessonNumber = Number(m[1]);
  const inLessonOrder = Number(m[2]);
  const slug = m[3];
  const rawVidalyticsId = m[4];
  if (!slug || !rawVidalyticsId) return null;

  // Safety net: reconcile the captured id against the ids the guide references
  // so a mangled filename can't corrupt it.
  const vidalyticsId = sanitizeVidalyticsId(rawVidalyticsId);

  const section = BLITZ_SECTION_BY_ID[lessonNumber];
  const lessonTitle = section ? section.title : null;
  const humanSlug = humanizeSlug(slug);

  const title = lessonTitle
    ? `Lesson ${lessonNumber} · ${lessonTitle} · ${humanSlug}`
    : `Lesson ${lessonNumber} · ${humanSlug}`;

  // The lessons this video actually appears in, derived LIVE from the guide via
  // its Vidalytics id (a single video can be embedded in several lessons). Falls
  // back to the parsed {NN} when the id isn't (yet) referenced in the guide.
  const mappedLessons = getBlitzLessonsForVideo(vidalyticsId);
  const lessons = mappedLessons.length > 0 ? mappedLessons : [lessonNumber];

  const lessonRef = lessonTitle
    ? `Blitz lesson ${lessonNumber} (${lessonTitle})`
    : `Blitz lesson ${lessonNumber} (unknown lesson)`;
  // When the video is reused across lessons, record the full placement so the
  // captioned-once transcript is traceable to every lesson it serves.
  const crossLessonNote =
    lessons.length > 1
      ? ` Appears in Blitz lessons ${lessons.join(", ")}.`
      : "";
  const provenanceNote =
    `Blitz caption upload — Vidalytics video ${vidalyticsId}; ${lessonRef}, video ${inLessonOrder}.${crossLessonNote}`;

  return {
    lessonNumber,
    inLessonOrder,
    slug,
    vidalyticsId,
    rawVidalyticsId,
    lessons,
    lessonTitle,
    title,
    transcriptType: "blitz_video",
    provenanceNote,
  };
}

/** The subset of intake fields the Blitz autofill can populate. */
export interface BlitzAutofillFields {
  title?: string;
  transcriptType?: string;
  sourceName?: string;
  provenanceNote?: string;
  inLessonOrder?: number;
  vidalyticsId?: string;
}

/**
 * Auto-fill intake fields for an item whose `sourceName` matches the Blitz
 * caption convention. Each field is filled independently and ONLY when the
 * caller left it blank — an explicit title/type/provenance/order/id is always
 * respected. Non-matching names return the item untouched, preserving the
 * existing behavior (raw filename as source, no auto type).
 */
export function applyBlitzCaptionAutofill<T extends BlitzAutofillFields>(item: T): T {
  const meta = parseBlitzCaptionFilename(item.sourceName);
  if (!meta) return item;
  const hasTitle = typeof item.title === "string" && item.title.trim() !== "";
  const hasType = typeof item.transcriptType === "string" && item.transcriptType !== "";
  const hasProvenance =
    typeof item.provenanceNote === "string" && item.provenanceNote.trim() !== "";
  const hasOrder = typeof item.inLessonOrder === "number";
  const hasVidId =
    typeof item.vidalyticsId === "string" && item.vidalyticsId.trim() !== "";
  return {
    ...item,
    title: hasTitle ? item.title : meta.title,
    transcriptType: hasType ? item.transcriptType : meta.transcriptType,
    provenanceNote: hasProvenance ? item.provenanceNote : meta.provenanceNote,
    inLessonOrder: hasOrder ? item.inLessonOrder : meta.inLessonOrder,
    vidalyticsId: hasVidId ? item.vidalyticsId : meta.vidalyticsId,
  };
}
