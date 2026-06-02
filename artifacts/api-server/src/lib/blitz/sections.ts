/**
 * Canonical Blitz section + phase metadata for the backend.
 *
 * Mirrors BlitzHub.tsx LESSONS / phase structure so server-side services
 * (continue-resolver, coach dashboard, phase-gates) all operate from one
 * authoritative list instead of re-deriving it independently.
 *
 * When Task 2 seeds a `blitz_phases` / `blitz_sections` table this file
 * can be replaced (or updated to load from the DB) without touching any
 * of the callers.
 */

export type BlitzPhaseKey = "intro" | "build" | "test" | "scale";

export interface BlitzPhase {
  key: BlitzPhaseKey;
  /** Human-readable label surfaced in API responses and coach dashboard. */
  label: string;
  sortOrder: number;
}

export interface BlitzSection {
  id: number;
  /** courseId used in the course_progress table (and blitz_progress_events). */
  courseId: string;
  phase: BlitzPhaseKey;
  /** Step label within the phase (as shown in BlitzHub.tsx). */
  step: string;
  /** Full descriptive title. */
  title: string;
}

// ---------------------------------------------------------------------------
// Phase metadata
// ---------------------------------------------------------------------------

export const BLITZ_PHASES: readonly BlitzPhase[] = [
  { key: "intro", label: "Introduction", sortOrder: 0 },
  { key: "build", label: "Phase 1 — Build", sortOrder: 1 },
  { key: "test",  label: "Phase 2 — Test",  sortOrder: 2 },
  { key: "scale", label: "Phase 3 — Scale", sortOrder: 3 },
] as const;

export const BLITZ_PHASE_MAP: Readonly<Record<BlitzPhaseKey, BlitzPhase>> = Object.fromEntries(
  BLITZ_PHASES.map(p => [p.key, p]),
) as Record<BlitzPhaseKey, BlitzPhase>;

// ---------------------------------------------------------------------------
// Section metadata (mirrors BlitzHub.tsx LESSONS, ids 1–23)
// ---------------------------------------------------------------------------

const RAW_SECTIONS: Omit<BlitzSection, "courseId">[] = [
  { id:  1, phase: "intro", step: "Introduction",              title: "What Is Affiliate Arbitrage?" },
  { id:  2, phase: "intro", step: "Before You Start",          title: "Understand the System — The Three Phases, Your Budget, and the Phase Gates" },
  { id:  3, phase: "build", step: "Overview",                  title: "How Phase 1 Works — Campaign Architecture and Your Path" },
  { id:  4, phase: "build", step: "Network Selection",         title: "Choose Your Affiliate Network" },
  { id:  5, phase: "build", step: "Product Selection",         title: "Select Your Offer and Get Your Affiliate Link" },
  { id:  6, phase: "build", step: "Creative Assets",           title: "Understanding Creative Assets — The Foundation of Your Campaign" },
  { id:  7, phase: "build", step: "Creative Assets",           title: "Create Your Native Ad Assets" },
  { id:  8, phase: "build", step: "Creative Assets",           title: "Create Your Landing Page Assets — Media Mavens" },
  { id:  9, phase: "build", step: "Creative Assets",           title: "Create Your Landing Page Assets — ClickBank" },
  { id: 10, phase: "build", step: "Compliance",                title: "Submit Your Assets for Compliance Review" },
  { id: 11, phase: "build", step: "Flexy™ Setup",              title: "Setting Up Your Website in Flexy™" },
  { id: 12, phase: "build", step: "MetricMover™",              title: "Using MetricMover™" },
  { id: 13, phase: "build", step: "DIYTrax Setup",             title: "Set Up DIYTrax" },
  { id: 14, phase: "build", step: "Go Live",                   title: "Configure Caterpillar and Go Live" },
  { id: 15, phase: "test",  step: "Testing — Getting Started", title: "Find Your Winners Through Data" },
  { id: 16, phase: "test",  step: "Round 1 · Min. $500",       title: "Find Your Top Performing Headline" },
  { id: 17, phase: "test",  step: "Between Rounds 1 and 2",    title: "Prepare Additional Static Images While Round 1 Runs" },
  { id: 18, phase: "test",  step: "Round 2 · Min. $500",       title: "Find Your Top Performing Visual Creative" },
  { id: 19, phase: "test",  step: "Between Rounds 2 and 3",    title: "Prepare Your Round 3 Placement Format Assets" },
  { id: 20, phase: "test",  step: "Round 3 · Min. $1,000",     title: "Find Your Top Performing Placement Format" },
  { id: 21, phase: "scale", step: "Method 1",                  title: "Increase Budget on Your Top Performing Placement" },
  { id: 22, phase: "scale", step: "Method 2",                  title: "Test New Placements and Publishers" },
  { id: 23, phase: "scale", step: "Method 3",                  title: "Master Publisher" },
];

export const BLITZ_SECTIONS: readonly BlitzSection[] = RAW_SECTIONS.map(
  s => ({ ...s, courseId: `blitz-hub-step-v2-${s.id}` } satisfies BlitzSection),
);

/** Total canonical section count. */
export const BLITZ_SECTION_COUNT = BLITZ_SECTIONS.length; // 23

/** Fast lookup: courseId → BlitzSection */
export const BLITZ_SECTION_BY_COURSE_ID: Readonly<Record<string, BlitzSection>> = Object.fromEntries(
  BLITZ_SECTIONS.map(s => [s.courseId, s]),
);

/** Fast lookup: section id → BlitzSection */
export const BLITZ_SECTION_BY_ID: Readonly<Record<number, BlitzSection>> = Object.fromEntries(
  BLITZ_SECTIONS.map(s => [s.id, s]),
);
