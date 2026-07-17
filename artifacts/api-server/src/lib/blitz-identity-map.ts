import {
  BLITZ_SECTION_BY_ID,
  type BlitzSection,
  type BlitzPhaseKey,
} from "@workspace/blitz-curriculum";
import { BLITZ_SECTION_TO_NODE } from "./kb-taxonomy.js";

/**
 * Blitz lesson identity reconciliation map — the durable crosswalk from the
 * internal Blitz numbering to the canonical member-facing Blitz guide.
 *
 * WHY THIS EXISTS
 * ───────────────
 * There are THREE disconnected Blitz numbering systems in the codebase:
 *
 *   1. AI Source Knowledge reference docs (`ai_source_documents`,
 *      `source_type = 'reference_docs'`, 96 rows) — titled
 *      `The Blitz™ Lesson — 3.18b: …`. Internal mining input only.
 *   2. `blitz_lessons` (94 granular rows) — `lesson_id` like `3.18b`, with
 *      `phase` / `module` / `blitz_order`. Internal. Its `blitz_order` has
 *      known collisions (3.18a/3.19 share an order; 3.20/3.18b share the next).
 *   3. The member-facing `/blitz` guide — the canonical
 *      `@workspace/blitz-curriculum`: 23 sections (ids 1..23), 4 phases, real
 *      titles, `sectionAnchor` (e.g. `s6c`) and `courseId`
 *      (`blitz-hub-step-v2-N`). THIS IS THE ONLY THING A MEMBER SEES / CLICKS.
 *
 * The `3.x` / `3.18b` numbering and `blitz_lessons.lesson_id` are INTERNAL and
 * are never surfaced to members. A member pointed at "3.18b" would be lost.
 * This map resolves each of the 96 reference-doc source documents to the one
 * canonical member-facing section it belongs to, so every future
 * pointer/crosslink built on top of the AI Source Knowledge corpus resolves to
 * a real, navigable section (id, step/title, `sectionAnchor`, `courseId`) and
 * its Process node (via {@link BLITZ_SECTION_TO_NODE}).
 *
 * HOW THE MAPPING WAS RESOLVED
 * ────────────────────────────
 * The task description hoped to bridge lesson→section structurally via the
 * guide video map (`getBlitzLessonsForVideo`). In practice the seed lessons'
 * `source_video_id`s (81 distinct) do NOT overlap the current guide's video ids
 * (48) at all — that bridge resolves 0/94 lessons because the guide was rebuilt
 * with new Vidalytics ids after the lessons were captured. So the crosswalk is
 * resolved by lesson_id / phase / module / title/content judgment instead. See
 * `docs/blitz-identity-reconciliation-report.md` for coverage + caveats and
 * `docs/blitz-ai-knowledge-roadmap.md` for the larger initiative.
 *
 * POST-AUDIT SECTION REALIGNMENT (2026-07-17)
 * ────────────────────────────────────────────
 * A corpus-wide audit cross-referenced lesson titles against the LIVE guide's
 * video placements (`getBlitzVideoMap()` from `@workspace/blitz-curriculum`)
 * and corrected 13 misfiled entries: 3.6/3.7 → 8 (copy blocks — the guide
 * teaches them in sections 8 AND 9; 8 is the primary home), 6.1 → 9,
 * 6.22/7.1/7.6/7.7/7B.5 → 12 (DIYTrax setup), 10.1/10.2/10.4/10.5/10.6 → 19
 * (Round 3 placement assets). 3.10/3.11 (stay 8) and 10.7 (stays 18,
 * round2-launch caveat) were audit near-misses judged correct as-is — do not
 * "fix" them back. Note 3.7's title is a known mispairing: its source video is
 * a second copy-blocks call, not hero-shot training (title kept verbatim to
 * honor the `blitz_lessons.title` drift contract).
 *
 * This is a code-owned, drift-guarded map (same pattern as
 * {@link BLITZ_SECTION_TO_NODE}). `blitz-identity-map-drift.test.ts` asserts it
 * covers EXACTLY the expected reference-doc source set (the 94 `blitz_lessons`
 * titles from `blitz-seed.json` + the 2 core-training prose docs) and that
 * every target is a real canonical section / Process node.
 *
 * SCOPE: this is a foundation data map only. It changes NO retrieval, synthesis
 * or publish behaviour and edits nothing member-facing.
 */

// ───────────────────────────────────────────────────────────────────────────
// Source-doc title contract (single source, shared with the seeder)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Prefix the core-training seeder puts in front of every `blitz_lessons.title`
 * when it files the lesson as an `ai_source_documents` reference doc. Single
 * source of truth for the reference-doc title so this map and
 * `seed-core-training-sources.ts` can never drift apart.
 */
export const BLITZ_LESSON_SOURCE_PREFIX = "The Blitz™ Lesson — ";

/** The exact `ai_source_documents.title` a lesson is filed under. */
export function blitzSourceDocTitle(lessonTitle: string): string {
  return `${BLITZ_LESSON_SOURCE_PREFIX}${lessonTitle}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Mapping caveats (attached to entries that don't map to a single clean home)
// ───────────────────────────────────────────────────────────────────────────

export type BlitzMappingCaveat =
  | "grasshopper-crane"
  | "round2-launch"
  | "publisher-options"
  | "conceptual-def"
  | "core-training";

export const BLITZ_MAPPING_CAVEATS: Readonly<Record<BlitzMappingCaveat, string>> = {
  "grasshopper-crane":
    "Grasshopper/Crane (secondary-publisher / banner) content — the Caterpillar-only member guide has no dedicated section for it; mapped to the nearest equivalent Caterpillar section.",
  "round2-launch":
    'Sole source touching Round 2 execution; the rest of the internal "Preparing for Round 2" module maps to section 17 (Between Rounds 1 and 2).',
  "publisher-options":
    "Traffic-source / publisher options overview — no dedicated member section; filed under the Phase 1 overview (section 3).",
  "conceptual-def":
    "Conceptual definitions doc — filed under the Creative Assets foundation (section 6) rather than a hands-on landing-page section.",
  "core-training":
    "Core-training prose (not a Blitz lesson) — mapped to the nearest foundations section.",
};

// ───────────────────────────────────────────────────────────────────────────
// Raw crosswalk data (human-authored + reviewable)
// ───────────────────────────────────────────────────────────────────────────

/**
 * One entry per `blitz_lessons` row (94). `lessonId` is the internal
 * `blitz_lessons.lesson_id` (null for the strategy/prose docs that carry none);
 * `title` is the exact `blitz_lessons.title` (the reference-doc title is
 * {@link blitzSourceDocTitle}(title)); `section` is the canonical member-facing
 * section id (1..23). Ordered by internal `blitz_order`.
 */
interface RawLessonIdentity {
  lessonId: string | null;
  section: number;
  title: string;
  note?: BlitzMappingCaveat;
}

const BLITZ_LESSON_IDENTITIES: readonly RawLessonIdentity[] = [
  { lessonId: "1.1"    , section:  1, title: "1.1: Affiliate Arbitrage Overview" },
  { lessonId: "2.1"    , section:  4, title: "2.1: Choose Your Affiliate Network" },
  { lessonId: "2.2"    , section:  5, title: "2.2: Logging Into Media Mavens For The First Time" },
  { lessonId: "2.3"    , section:  5, title: "2.3: Choosing Your Media Mavens Product To Promote" },
  { lessonId: "2.5"    , section:  5, title: "2.5: Choosing Your ClickBank Product To Promote" },
  { lessonId: "3.1"    , section:  6, title: "3.1: Landing Page Overview" },
  { lessonId: "3.2"    , section: 11, title: "3.2: Clone Flexy Website" },
  { lessonId: "3.3"    , section: 11, title: "3.3: Add Domain To Flexy" },
  { lessonId: "3.4"    , section: 11, title: "3.4: Connect Domain To Website" },
  { lessonId: "3.5"    , section: 11, title: "3.5: Clone Page Into Any Website" },
  { lessonId: "3.6"    , section:   8, title: "3.6: Copy Blocks Headline Training" },
  { lessonId: "3.7"    , section:   8, title: "3.7: Hero Shot Selection and Creation Training" },
  { lessonId: "3.8"    , section:  8, title: "3.8: Cloning Your Advertorial Page" },
  { lessonId: "3.9"    , section:  8, title: "3.9: Creating Split Test Variants for Your Advertorial" },
  { lessonId: "3.10"   , section:  8, title: "3.10: Generate Advertorial Headlines with AffiliateCMO" },
  { lessonId: "3.11"   , section:  8, title: "3.11: Generate Advertorial Headlines with FreeAdCopy" },
  { lessonId: "3.12"   , section:  8, title: "3.12: Generate/Find 5 Advertorial Hero Shots" },
  { lessonId: "3.13"   , section: 10, title: "3.13: Submit Advertorial Split Test Media to Compliance" },
  { lessonId: "3.14"   , section:  9, title: "3.14: Install Video DownloadHelper in Firefox" },
  { lessonId: "3.15"   , section:  9, title: "3.15: Download Your VSL" },
  { lessonId: "3.16"   , section:  9, title: "3.16: How to Get a Transcription from Your VSL" },
  { lessonId: "3.17a"  , section:  9, title: "3.17a: How to Generate Angles — Affiliate Angle Architect Bot" },
  { lessonId: "3.17b"  , section:  9, title: "3.17b: Generating Landing Page Angles Using POE" },
  { lessonId: "3.18a"  , section:  9, title: "3.18a: How to Use the Bridge Page Bot" },
  { lessonId: "3.19"   , section:  9, title: "3.19: Choosing a Jump Page Base to Clone" },
  { lessonId: "3.20"   , section:  9, title: "3.20: Create Your Landing Page Base Copy" },
  { lessonId: "3.18b"  , section:  9, title: "3.18b: How to Generate Jump Page Body Copy — Bridge Page Copy Bot" },
  { lessonId: "4.1"    , section:  6, title: "4.1: Finding Your Edge With Ad Banner Psychology" },
  { lessonId: "4.2"    , section:  7, title: "4.2: How to Create Ad Headlines and Descriptions" },
  { lessonId: "4.3"    , section:  7, title: "4.3: How to Create An Ad Image (16x9)" },
  { lessonId: "4.4"    , section: 10, title: "4.4: Submit Ad Split Test Media to Compliance" },
  { lessonId: "4.5"    , section:  7, title: "4.5: Creating Ad Banner Variants for Testing", note: "grasshopper-crane" },
  { lessonId: "5.1"    , section: 12, title: "5.1: Create DIYTrax Campaign Placeholder" },
  { lessonId: "5.2"    , section: 12, title: "5.2: DIYTrax ClickBank IPN Integration" },
  { lessonId: "5.3"    , section: 12, title: "5.3: Add DIYTrax LP Offer Link in Flexy Custom Value" },
  { lessonId: "5.4"    , section: 12, title: "5.4: Add DIYTrax LP Offer Link Directly in Flexy" },
  { lessonId: "6.1"    , section:  9, title: "6.1: Optimize Landing Page Base Copy" },
  { lessonId: "6.2"    , section: 13, title: "6.2: How to Know Whether to Use MetricMover or Individual Landing Pages" },
  { lessonId: "6.3"    , section: 13, title: "6.3: What You Need For A MetricMover Test" },
  { lessonId: "6.4"    , section: 13, title: "6.4: Creating A New MetricMover Campaign" },
  { lessonId: "6.5"    , section: 13, title: "6.5: How To Import Your Landing Page Into MetricMover" },
  { lessonId: "6.6"    , section: 13, title: "6.6: How To Create Headline Variants In MetricMover" },
  { lessonId: "6.7"    , section: 13, title: "6.7: How To Upload Hero Shots To Flexy For Use In MetricMover" },
  { lessonId: "6.8"    , section: 13, title: "6.8: How To Create Hero Shot Variants In MetricMover" },
  { lessonId: "6.9"    , section: 13, title: "6.9: How To Set Up A Flexy Page For MetricMover Code" },
  { lessonId: "6.10"   , section: 13, title: "6.10: How To Export MetricMover Campaign Files" },
  { lessonId: "6.11"   , section: 13, title: "6.11: How To Find Your MetricMover Code File" },
  { lessonId: "6.12"   , section: 13, title: "6.12: How To Embed MetricMover Code Into A Flexy Page" },
  { lessonId: "6.13"   , section: 13, title: "6.13: How To Check MetricMover Page Variants" },
  { lessonId: "6.14"   , section: 13, title: "6.14: How To Find Your MetricMover .csv File For DIYTrax Import" },
  { lessonId: "6.15"   , section: 13, title: "6.15: How To Import MetricMover Page Variants Into DIYTrax" },
  { lessonId: "6.16"   , section: 13, title: "6.16: What You Need for Cloned Flexy Page Test" },
  { lessonId: "6.17"   , section: 13, title: "6.17: How to Duplicate Your Base Flexy Page" },
  { lessonId: "6.18"   , section: 13, title: "6.18: How to Change The Headline and Hero Shot" },
  { lessonId: "6.19"   , section: 13, title: "6.19: Further Page Edits" },
  { lessonId: "6.20"   , section: 13, title: "6.20: Cloning and Editing More Landing Page Variants" },
  { lessonId: "6.21"   , section: 13, title: "6.21: Gathering Your Landing Page Variant URLs for DIYTrax" },
  { lessonId: "6.22"   , section: 12, title: "6.22: Adding Your Landing Page Variant URLs to DIYTrax" },
  { lessonId: "7.1"    , section: 12, title: "7.1: DIYTrax Campaign Basic Info" },
  { lessonId: "7.2"    , section: 14, title: "7.2: Configure Traffic Source Settings" },
  { lessonId: "7.3"    , section: 14, title: "7.3: Create Your First Native Ad" },
  { lessonId: "7.4"    , section: 14, title: "7.4: Create More Ads" },
  { lessonId: "7.6"    , section: 12, title: "7.6: Add Your Landing Pages in DIYTrax" },
  { lessonId: "7.7"    , section: 12, title: "7.7: Place Affiliate Link in DIYTrax Campaign Offer Pages" },
  { lessonId: "7.8"    , section: 14, title: "7.8: Final QA Campaign Check and Set to Live" },
  { lessonId: "7B.2"   , section: 14, title: "7B.2: Configure Traffic Source Settings", note: "grasshopper-crane" },
  { lessonId: "7B.3"   , section: 14, title: "7B.3: Upload Ad Banners", note: "grasshopper-crane" },
  { lessonId: "7B.4"   , section: 14, title: "7B.4: Fund Your Traffic Source", note: "grasshopper-crane" },
  { lessonId: "7B.5"   , section: 12, title: "7B.5: Place Affiliate Link in Campaign Offer Pages", note: "grasshopper-crane" },
  { lessonId: "7B.6"   , section: 14, title: "7B.6: Final QA Campaign Check", note: "grasshopper-crane" },
  { lessonId: "7B.7"   , section: 14, title: "7B.7: Submit Banners and Turn Campaign Active", note: "grasshopper-crane" },
  { lessonId: "7B.8"   , section: 14, title: "7B.8: How Traffic Source Works and What to Expect", note: "grasshopper-crane" },
  { lessonId: "8.2"    , section: 16, title: "8.2: Round 1 — When to Make a Banner Inactive" },
  { lessonId: "8.3"    , section: 16, title: "8.3: Round 1 — What To Do If Campaign Turns Off Before $1500" },
  { lessonId: "10.1"   , section: 19, title: "10.1: How to Use Cropbot to Create 9x16 Image" },
  { lessonId: "10.2"   , section: 19, title: "10.2: How to Create Videos From Round 1 Image" },
  { lessonId: "10.3"   , section: 17, title: "10.3: How to Trim Video Length" },
  { lessonId: "10.4"   , section: 19, title: "10.4: How to Convert Videos to GIFs Using Adobe Express" },
  { lessonId: "10.5"   , section: 19, title: "10.5: How to Reduce GIF File Size Using GIFSTER" },
  { lessonId: "10.6"   , section: 19, title: "10.6: How to Convert Videos to GIFs Using GIFSTER" },
  { lessonId: "10.7"   , section: 18, title: "10.7: How to Create Ads and Launch Round 2", note: "round2-launch" },
  { lessonId: null     , section: 15, title: "Understanding the Testing Reality — Caterpillar" },
  { lessonId: null     , section: 15, title: "Understanding the Testing Reality — Grasshopper & Crane", note: "grasshopper-crane" },
  { lessonId: null     , section:  3, title: "Publisher Overview — Know Your Options", note: "publisher-options" },
  { lessonId: null     , section: 17, title: "What Happens After Round 1" },
  { lessonId: null     , section: 17, title: "Preparing for Round 2" },
  { lessonId: null     , section: 21, title: "Phase 3: SCALE — Multiplying Your Profits" },
  { lessonId: null     , section: 16, title: "What's Working Now — Caterpillar Round 1 Recommendations" },
  { lessonId: null     , section: 16, title: "What's Working Now — Grasshopper/Crane Round 1 Recommendations", note: "grasshopper-crane" },
  { lessonId: null     , section: 16, title: "Round 1 Campaign Management Guide" },
  { lessonId: null     , section:  2, title: "Your Blitz Roadmap" },
  { lessonId: null     , section:  2, title: "BTS Support Guide" },
  { lessonId: null     , section:  6, title: "Copy Blocks Headline Writing Framework" },
  { lessonId: null     , section:  6, title: "Definitions: Landing Pages, Bridge Pages, Jump Pages, VSLs", note: "conceptual-def" },
];

/**
 * The two core-training prose docs. These are NOT `blitz_lessons` rows — they
 * are authored directly by the seeder, so their reference-doc title IS the doc
 * title (no {@link BLITZ_LESSON_SOURCE_PREFIX}). Kept in lockstep with
 * `CORE_TRAINING_PROSE_TITLES` in `seed-core-training-sources.ts` by the drift
 * guard.
 */
interface RawProseIdentity {
  sourceDocTitle: string;
  section: number;
  note?: BlitzMappingCaveat;
}

const BLITZ_PROSE_IDENTITIES: readonly RawProseIdentity[] = [
  {
    sourceDocTitle: "The 7 Pillars™ of a Profitable Digital Business (Core Training)",
    section: 1,
    note: "core-training",
  },
  {
    sourceDocTitle: "What The Blitz™ Is — And Why It's Built the Way It Is (Core Training)",
    section: 2,
    note: "core-training",
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Resolved crosswalk (what consumers use)
// ───────────────────────────────────────────────────────────────────────────

export type BlitzSourceKind = "lesson" | "prose";

export interface BlitzIdentityEntry {
  /** Exact `ai_source_documents.title` this source doc is filed under. */
  sourceDocTitle: string;
  /** Internal `blitz_lessons.lesson_id` (e.g. "3.18b"); null for prose / strategy docs. */
  lessonId: string | null;
  /** Whether this is a Blitz lesson doc or a core-training prose doc. */
  kind: BlitzSourceKind;
  /** Canonical member-facing section id (1..23). */
  section: number;
  /** Full member-facing section metadata (title, step, phase, anchor, courseId). */
  sectionMeta: BlitzSection;
  /** Member-facing guide anchor (e.g. "s6c"). */
  sectionAnchor: string;
  /** Persisted courseId (`blitz-hub-step-v2-N`). */
  courseId: string;
  /** Curriculum phase (`intro` | `build` | `test` | `scale`). */
  phase: BlitzPhaseKey;
  /** Process node this section maps to (via BLITZ_SECTION_TO_NODE). */
  processNode: string;
  /** Optional caveat when the mapping is a judgment call — see BLITZ_MAPPING_CAVEATS. */
  caveat?: BlitzMappingCaveat;
}

function resolveSection(section: number, sourceDocTitle: string): BlitzSection {
  const meta = BLITZ_SECTION_BY_ID[section];
  if (!meta) {
    throw new Error(
      `blitz-identity-map: "${sourceDocTitle}" maps to unknown section id ${section}`,
    );
  }
  return meta;
}

/**
 * The full resolved crosswalk: one {@link BlitzIdentityEntry} per reference-doc
 * source document (94 lessons + 2 prose = 96), each carrying its canonical
 * member-facing section identity + Process node. This is the artifact the later
 * "Concept Layer Synthesis" and "Lesson Layer Publish" workstreams consume.
 */
export const BLITZ_IDENTITY_CROSSWALK: readonly BlitzIdentityEntry[] = [
  ...BLITZ_LESSON_IDENTITIES.map((raw): BlitzIdentityEntry => {
    const sourceDocTitle = blitzSourceDocTitle(raw.title);
    const sectionMeta = resolveSection(raw.section, sourceDocTitle);
    return {
      sourceDocTitle,
      lessonId: raw.lessonId,
      kind: "lesson",
      section: raw.section,
      sectionMeta,
      sectionAnchor: sectionMeta.sectionAnchor,
      courseId: sectionMeta.courseId,
      phase: sectionMeta.phase,
      processNode: BLITZ_SECTION_TO_NODE[raw.section],
      caveat: raw.note,
    };
  }),
  ...BLITZ_PROSE_IDENTITIES.map((raw): BlitzIdentityEntry => {
    const sectionMeta = resolveSection(raw.section, raw.sourceDocTitle);
    return {
      sourceDocTitle: raw.sourceDocTitle,
      lessonId: null,
      kind: "prose",
      section: raw.section,
      sectionMeta,
      sectionAnchor: sectionMeta.sectionAnchor,
      courseId: sectionMeta.courseId,
      phase: sectionMeta.phase,
      processNode: BLITZ_SECTION_TO_NODE[raw.section],
      caveat: raw.note,
    };
  }),
];

/** Fast lookup: exact `ai_source_documents.title` → resolved crosswalk entry. */
export const BLITZ_IDENTITY_BY_SOURCE_TITLE: ReadonlyMap<string, BlitzIdentityEntry> = new Map(
  BLITZ_IDENTITY_CROSSWALK.map((e) => [e.sourceDocTitle, e]),
);

/** Fast lookup: internal `lesson_id` → resolved crosswalk entry (lessons only). */
export const BLITZ_IDENTITY_BY_LESSON_ID: ReadonlyMap<string, BlitzIdentityEntry> = new Map(
  BLITZ_IDENTITY_CROSSWALK.filter((e) => e.lessonId != null).map((e) => [e.lessonId as string, e]),
);

/** Resolve a reference-doc title to its canonical member-facing section entry. */
export function resolveBlitzSourceDoc(sourceDocTitle: string): BlitzIdentityEntry | null {
  return BLITZ_IDENTITY_BY_SOURCE_TITLE.get(sourceDocTitle.trim()) ?? null;
}

/** Resolve an internal `lesson_id` (e.g. "3.18b") to its section entry. */
export function resolveBlitzLessonId(lessonId: string): BlitzIdentityEntry | null {
  return BLITZ_IDENTITY_BY_LESSON_ID.get(lessonId.trim()) ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// Coverage + collision report data (derived — see the .md report for prose)
// ───────────────────────────────────────────────────────────────────────────

/** Source-doc count mapped to each canonical section id (1..23), zero-filled. */
export const BLITZ_SECTION_COVERAGE: Readonly<Record<number, number>> = (() => {
  const cov: Record<number, number> = {};
  for (const id of Object.keys(BLITZ_SECTION_BY_ID)) cov[Number(id)] = 0;
  for (const e of BLITZ_IDENTITY_CROSSWALK) cov[e.section] = (cov[e.section] ?? 0) + 1;
  return cov;
})();

/** Canonical sections with ZERO source-doc coverage (a content gap). */
export const BLITZ_SECTIONS_WITHOUT_SOURCES: readonly number[] = Object.entries(
  BLITZ_SECTION_COVERAGE,
)
  .filter(([, count]) => count === 0)
  .map(([id]) => Number(id))
  .sort((a, b) => a - b);

/** Canonical sections with only a single (thin) source doc. */
export const BLITZ_SECTIONS_WITH_THIN_COVERAGE: readonly number[] = Object.entries(
  BLITZ_SECTION_COVERAGE,
)
  .filter(([, count]) => count === 1)
  .map(([id]) => Number(id))
  .sort((a, b) => a - b);

/**
 * Known `blitz_lessons.blitz_order` collisions — distinct lessons that share an
 * order value. Documented so the ordering is understood as internal-only and
 * never treated as a stable key. (Order is NOT used for the crosswalk; the map
 * keys on the reference-doc title / lesson_id.)
 */
export const BLITZ_ORDER_COLLISIONS: readonly {
  order: number;
  lessonIds: readonly string[];
}[] = [
  { order: 27, lessonIds: ["3.18a", "3.19"] },
  { order: 28, lessonIds: ["3.20", "3.18b"] },
];
