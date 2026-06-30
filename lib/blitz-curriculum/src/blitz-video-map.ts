import { BLITZ_BODY_HTML } from "./blitz-body-html";

/**
 * Dynamic Blitz video -> lessons map.
 *
 * A single Blitz video can appear in MORE THAN ONE lesson (e.g. the
 * "Using AI to Generate Ad Images" video is embedded in lessons 7, 8 and 9).
 * Admins caption each unique video ONCE; the placements are derived here, live,
 * from the same Blitz guide HTML the portal renders — so when the guide content
 * changes (a video moves, a new video/Vidalytics id is added, or a placement is
 * removed) this map adapts automatically with nothing to hand-maintain.
 *
 * The guide markup lays each video out as:
 *
 *   <span class="mod-badge build">7 — Build — Native Ad Assets</span>
 *   ...
 *   <div class="video-slot" data-vidalytics-id="KdXJA4N4m_Z_aW7Y" ...>
 *     <div class="vt">Using AI to Generate Ad Images</div>
 *
 * The numeric prefix of the most recent `mod-badge` IS the canonical Blitz
 * lesson id (matches @workspace/blitz-curriculum BLITZ_SECTION_BY_ID), so we
 * walk the HTML in order, tracking the current lesson, and attach every
 * `data-vidalytics-id` we encounter to it.
 */

export interface BlitzVideoPlacement {
  /** The lesson id (1-based, matches BLITZ_SECTION_BY_ID). */
  lesson: number;
  /** The video's 1-based order within that lesson. */
  order: number;
  /** The slot title (`.vt`) when present. */
  title: string | null;
}

export interface BlitzVideoInfo {
  vidalyticsId: string;
  /** Every lesson the video appears in, ascending, de-duplicated. */
  lessons: number[];
  /** Per-lesson placement detail (lesson + in-lesson order + title). */
  placements: BlitzVideoPlacement[];
  /** First non-empty slot title seen for the video. */
  title: string | null;
}

export interface BlitzVideoMap {
  /** Vidalytics id -> info. */
  byVideoId: ReadonlyMap<string, BlitzVideoInfo>;
  /** Lesson id -> the videos placed in it, in document order. */
  byLesson: ReadonlyMap<number, BlitzVideoPlacement[]>;
  /** Every distinct Vidalytics id referenced anywhere in the guide. */
  knownIds: ReadonlySet<string>;
}

// `<span class="mod-badge ...">7 — ...` / `7 - ...` — capture the leading number.
const BADGE_RE = /mod-badge[^>]*>\s*(\d{1,3})\s*[—-]/g;
// `data-vidalytics-id="..."` — capture the id.
const SLOT_RE = /data-vidalytics-id="([^"]+)"/g;
// `class="vt">Title<` — capture the slot title when on the same chunk.
const VT_RE = /class="vt">([^<]*)</;

interface Token {
  index: number;
  kind: "badge" | "slot";
  value: string;
  title: string | null;
}

function buildMap(html: string): BlitzVideoMap {
  // Collect badge + slot tokens with their positions, then replay in order.
  const tokens: Token[] = [];

  BADGE_RE.lastIndex = 0;
  for (let m = BADGE_RE.exec(html); m; m = BADGE_RE.exec(html)) {
    tokens.push({ index: m.index, kind: "badge", value: m[1], title: null });
  }
  SLOT_RE.lastIndex = 0;
  for (let m = SLOT_RE.exec(html); m; m = SLOT_RE.exec(html)) {
    // Look a little past the slot opening for its `.vt` title.
    const window = html.slice(m.index, m.index + 600);
    const vt = window.match(VT_RE);
    tokens.push({
      index: m.index,
      kind: "slot",
      value: m[1],
      title: vt ? vt[1].trim() : null,
    });
  }
  tokens.sort((a, b) => a.index - b.index);

  const byVideoId = new Map<string, BlitzVideoInfo>();
  const byLesson = new Map<number, BlitzVideoPlacement[]>();
  const knownIds = new Set<string>();
  let currentLesson: number | null = null;

  for (const tok of tokens) {
    if (tok.kind === "badge") {
      currentLesson = Number(tok.value);
      continue;
    }
    const id = tok.value;
    knownIds.add(id);
    if (currentLesson == null) continue;

    const lessonPlacements = byLesson.get(currentLesson) ?? [];
    const order = lessonPlacements.length + 1;
    const placement: BlitzVideoPlacement = {
      lesson: currentLesson,
      order,
      title: tok.title,
    };
    lessonPlacements.push(placement);
    byLesson.set(currentLesson, lessonPlacements);

    const info = byVideoId.get(id);
    if (info) {
      if (!info.lessons.includes(currentLesson)) info.lessons.push(currentLesson);
      info.placements.push(placement);
      if (!info.title && tok.title) info.title = tok.title;
    } else {
      byVideoId.set(id, {
        vidalyticsId: id,
        lessons: [currentLesson],
        placements: [placement],
        title: tok.title,
      });
    }
  }

  for (const info of byVideoId.values()) {
    info.lessons.sort((a, b) => a - b);
  }

  return { byVideoId, byLesson, knownIds };
}

let cached: BlitzVideoMap | null = null;

/** The Blitz video map, derived once from the live guide HTML and memoized. */
export function getBlitzVideoMap(): BlitzVideoMap {
  if (!cached) cached = buildMap(BLITZ_BODY_HTML);
  return cached;
}

/** Every Vidalytics id referenced anywhere in the Blitz guide. */
export function getKnownVidalyticsIds(): ReadonlySet<string> {
  return getBlitzVideoMap().knownIds;
}

/**
 * The lessons a given Vidalytics video appears in, ascending. Empty when the id
 * isn't referenced anywhere in the current guide.
 */
export function getBlitzLessonsForVideo(vidalyticsId: string): number[] {
  return getBlitzVideoMap().byVideoId.get(vidalyticsId)?.lessons ?? [];
}

/** Full placement info for a Vidalytics video, or null when unreferenced. */
export function getBlitzVideoInfo(vidalyticsId: string): BlitzVideoInfo | null {
  return getBlitzVideoMap().byVideoId.get(vidalyticsId) ?? null;
}
