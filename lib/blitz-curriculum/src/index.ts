/**
 * Canonical Blitz curriculum skeleton — the SINGLE source of truth shared by
 * both the portal (frontend) and the api-server (backend).
 *
 * This package holds only the structural skeleton of the 23-step / 4-phase
 * Blitz curriculum: phase metadata (slug/name/color/order) and per-section
 * identity (id, courseId, phase, step label, title, guide section anchor).
 *
 * Presentational extras that are surface-specific — the lesson-hub long
 * descriptions, path tags, the guide pager's short titles and deep-link
 * labels — intentionally live next to the components that render them. Those
 * components key off the ids defined here, and a drift-guard test in each
 * surface asserts they cover exactly this id set.
 *
 * GOLDEN RULES (do not break — these are load-bearing across the DB):
 *   - The courseId format is `blitz-hub-step-v2-${id}` for ids 1..23.
 *     It is persisted in `course_progress` / `blitz_progress_events`; never
 *     rename it or renumber the ids.
 *   - BLITZ_SECTION_COUNT must stay 23 unless the curriculum genuinely changes.
 */

export type BlitzPhaseKey = "intro" | "build" | "test" | "scale";

export interface BlitzPhase {
  /** Stable slug; persisted as `blitz_phases.slug`. */
  key: BlitzPhaseKey;
  /** Human-readable label surfaced in API responses + coach dashboard. */
  label: string;
  sortOrder: number;
  /** Hex accent color; persisted as `blitz_phases.color`. */
  color: string;
}

export interface BlitzSection {
  id: number;
  /** courseId used in course_progress / blitz_progress_events. */
  courseId: string;
  phase: BlitzPhaseKey;
  /** Step label within the phase (as shown in the lesson hub). */
  step: string;
  /** Full descriptive title. */
  title: string;
  /** Anchor id of this section inside the full Blitz guide (e.g. "s6b"). */
  sectionAnchor: string;
}

/** courseId prefix persisted in the DB. */
export const BLITZ_COURSE_ID_PREFIX = "blitz-hub-step-v2-";

/** Build the canonical courseId for a section id. */
export function buildBlitzCourseId(id: number): string {
  return `${BLITZ_COURSE_ID_PREFIX}${id}`;
}

/**
 * Postgres regex body (`text ~ ...`) matching any v2 Blitz courseId, i.e.
 * `^blitz-hub-step-v2-[0-9]+$`. Single source for the raw-SQL filters in the
 * api-server (continue resolver, coach dashboard) so the prefix can never drift
 * from {@link BLITZ_COURSE_ID_PREFIX}. The prefix contains no regex
 * metacharacters, so it is safe to embed verbatim.
 */
export const BLITZ_V2_COURSE_ID_SQL_PATTERN = `^${BLITZ_COURSE_ID_PREFIX}[0-9]+$`;

// ---------------------------------------------------------------------------
// Phase metadata
// ---------------------------------------------------------------------------

export const BLITZ_PHASES: readonly BlitzPhase[] = [
  { key: "intro", label: "Introduction",     sortOrder: 0, color: "#475569" },
  { key: "build", label: "Phase 1 — Build",  sortOrder: 1, color: "#188f4a" },
  { key: "test",  label: "Phase 2 — Test",   sortOrder: 2, color: "#cf550a" },
  { key: "scale", label: "Phase 3 — Scale",  sortOrder: 3, color: "#7f2ac9" },
] as const;

export const BLITZ_PHASE_MAP: Readonly<Record<BlitzPhaseKey, BlitzPhase>> = Object.fromEntries(
  BLITZ_PHASES.map(p => [p.key, p]),
) as Record<BlitzPhaseKey, BlitzPhase>;

/** Phase keys in canonical (sortOrder) order. */
export const BLITZ_PHASE_ORDER: readonly BlitzPhaseKey[] = [...BLITZ_PHASES]
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map(p => p.key);

// ---------------------------------------------------------------------------
// Section metadata (ids 1–23)
// ---------------------------------------------------------------------------

const RAW_SECTIONS: Omit<BlitzSection, "courseId">[] = [
  { id:  1, phase: "intro", step: "Introduction",              title: "What Is Affiliate Arbitrage?",                                                            sectionAnchor: "s1"  },
  { id:  2, phase: "intro", step: "Before You Start",          title: "Understand the System — The Three Phases, Your Budget, and the Phase Gates",               sectionAnchor: "s2"  },
  { id:  3, phase: "build", step: "Overview",                  title: "How Phase 1 Works — Campaign Architecture and Your Path",                                  sectionAnchor: "s3"  },
  { id:  4, phase: "build", step: "Network Selection",         title: "Choose Your Affiliate Network",                                                           sectionAnchor: "s4"  },
  { id:  5, phase: "build", step: "Product Selection",         title: "Select Your Offer and Get Your Affiliate Link",                                           sectionAnchor: "s5"  },
  { id:  6, phase: "build", step: "Creative Assets",           title: "Understanding Creative Assets — The Foundation of Your Campaign",                          sectionAnchor: "s6"  },
  { id:  7, phase: "build", step: "Creative Assets",           title: "Create Your Native Ad Assets",                                                            sectionAnchor: "s6b" },
  { id:  8, phase: "build", step: "Creative Assets",           title: "Create Your Landing Page Assets — Media Mavens",                                          sectionAnchor: "s6c" },
  { id:  9, phase: "build", step: "Creative Assets",           title: "Create Your Landing Page Assets — ClickBank",                                             sectionAnchor: "s6d" },
  { id: 10, phase: "build", step: "Compliance",                title: "Submit Your Assets for Compliance Review",                                                sectionAnchor: "s7"  },
  { id: 11, phase: "build", step: "Flexy™ Setup",              title: "Setting Up Your Website in Flexy™",                                                       sectionAnchor: "s8"  },
  { id: 12, phase: "build", step: "DIYTrax Setup",             title: "Set Up DIYTrax",                                                                          sectionAnchor: "s9"  },
  { id: 13, phase: "build", step: "MetricMover™",              title: "Using MetricMover™",                                                                      sectionAnchor: "s8b" },
  { id: 14, phase: "build", step: "Go Live",                   title: "Configure Caterpillar and Go Live",                                                       sectionAnchor: "s10" },
  { id: 15, phase: "test",  step: "Testing — Getting Started", title: "Find Your Winners Through Data",                                                           sectionAnchor: "s11" },
  { id: 16, phase: "test",  step: "Round 1 · Min. $500",       title: "Find Your Top Performing Headline",                                                       sectionAnchor: "s12" },
  { id: 17, phase: "test",  step: "Between Rounds 1 and 2",    title: "Prepare Additional Static Images While Round 1 Runs",                                      sectionAnchor: "s13" },
  { id: 18, phase: "test",  step: "Round 2 · Min. $500",       title: "Find Your Top Performing Visual Creative",                                                sectionAnchor: "s14" },
  { id: 19, phase: "test",  step: "Between Rounds 2 and 3",    title: "Prepare Your Round 3 Placement Format Assets",                                             sectionAnchor: "s15" },
  { id: 20, phase: "test",  step: "Round 3 · Min. $1,000",     title: "Find Your Top Performing Placement Format",                                               sectionAnchor: "s16" },
  { id: 21, phase: "scale", step: "Method 1",                  title: "Increase Budget on Your Top Performing Placement",                                        sectionAnchor: "s17" },
  { id: 22, phase: "scale", step: "Method 2",                  title: "Test New Placements and Publishers",                                                      sectionAnchor: "s18" },
  { id: 23, phase: "scale", step: "Method 3",                  title: "Master Publisher",                                                                        sectionAnchor: "s19" },
];

export const BLITZ_SECTIONS: readonly BlitzSection[] = RAW_SECTIONS.map(
  s => ({ ...s, courseId: buildBlitzCourseId(s.id) } satisfies BlitzSection),
);

/** Total canonical section count. */
export const BLITZ_SECTION_COUNT = BLITZ_SECTIONS.length; // 23

/** All canonical section ids in order. */
export const BLITZ_SECTION_IDS: readonly number[] = BLITZ_SECTIONS.map(s => s.id);

/** Fast lookup: courseId → BlitzSection */
export const BLITZ_SECTION_BY_COURSE_ID: Readonly<Record<string, BlitzSection>> = Object.fromEntries(
  BLITZ_SECTIONS.map(s => [s.courseId, s]),
);

/** Fast lookup: section id → BlitzSection */
export const BLITZ_SECTION_BY_ID: Readonly<Record<number, BlitzSection>> = Object.fromEntries(
  BLITZ_SECTIONS.map(s => [s.id, s]),
);

/** Section count per phase, keyed by phase slug. */
export const BLITZ_PHASE_LESSON_COUNTS: Readonly<Record<BlitzPhaseKey, number>> = Object.fromEntries(
  BLITZ_PHASE_ORDER.map(key => [key, BLITZ_SECTIONS.filter(s => s.phase === key).length]),
) as Record<BlitzPhaseKey, number>;

// ---------------------------------------------------------------------------
// courseId helpers
// ---------------------------------------------------------------------------

/** True when `id` is a valid canonical Blitz v2 courseId (sections 1..count). */
export function isValidBlitzCourseId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  const prefix = BLITZ_COURSE_ID_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = id.match(new RegExp(`^${prefix}(\\d+)$`));
  if (!m) return false;
  const n = Number(m[1]);
  return n >= 1 && n <= BLITZ_SECTION_COUNT;
}

/** Extract the section id from a courseId, or 0 if it isn't a Blitz v2 id. */
export function blitzLessonIdFromCourseId(courseId: string): number {
  return isValidBlitzCourseId(courseId)
    ? Number(courseId.slice(BLITZ_COURSE_ID_PREFIX.length))
    : 0;
}

// Canonical Blitz guide body HTML (single source rendered by the portal and
// parsed by the backend) + the dynamic video -> lessons map derived from it.
export { BLITZ_BODY_HTML } from "./blitz-body-html";
export {
  getBlitzVideoMap,
  getKnownVidalyticsIds,
  getBlitzLessonsForVideo,
  getBlitzVideoInfo,
  type BlitzVideoMap,
  type BlitzVideoInfo,
  type BlitzVideoPlacement,
} from "./blitz-video-map";
