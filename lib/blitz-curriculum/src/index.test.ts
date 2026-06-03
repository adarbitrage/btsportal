import { describe, expect, it } from "vitest";
import {
  BLITZ_COURSE_ID_PREFIX,
  BLITZ_PHASES,
  BLITZ_PHASE_ORDER,
  BLITZ_PHASE_LESSON_COUNTS,
  BLITZ_SECTIONS,
  BLITZ_SECTION_COUNT,
  BLITZ_SECTION_BY_ID,
  BLITZ_SECTION_BY_COURSE_ID,
  BLITZ_V2_COURSE_ID_SQL_PATTERN,
  buildBlitzCourseId,
  isValidBlitzCourseId,
  blitzLessonIdFromCourseId,
} from "./index";

// This package is the single source of truth for the Blitz curriculum
// skeleton consumed by BOTH the portal and the api-server. These invariants
// guard the load-bearing contract (courseId format, count, phase membership)
// that is persisted in the DB — breaking any of them silently corrupts
// progress tracking, so they fail loudly here instead.
describe("Blitz curriculum skeleton", () => {
  it("pins the canonical count and courseId prefix", () => {
    expect(BLITZ_SECTION_COUNT).toBe(23);
    expect(BLITZ_SECTIONS).toHaveLength(23);
    expect(BLITZ_COURSE_ID_PREFIX).toBe("blitz-hub-step-v2-");
  });

  it("has contiguous ids 1..23 in order", () => {
    expect(BLITZ_SECTIONS.map(s => s.id)).toEqual(
      Array.from({ length: 23 }, (_, i) => i + 1),
    );
  });

  it("derives each courseId as the canonical prefix + id", () => {
    for (const s of BLITZ_SECTIONS) {
      expect(s.courseId).toBe(buildBlitzCourseId(s.id));
      expect(s.courseId).toBe(`blitz-hub-step-v2-${s.id}`);
    }
  });

  it("has unique courseIds and unique guide anchors", () => {
    const courseIds = new Set(BLITZ_SECTIONS.map(s => s.courseId));
    const anchors = new Set(BLITZ_SECTIONS.map(s => s.sectionAnchor));
    expect(courseIds.size).toBe(23);
    expect(anchors.size).toBe(23);
  });

  it("only uses declared phase keys, ordered by sortOrder", () => {
    const phaseKeys = new Set(BLITZ_PHASES.map(p => p.key));
    for (const s of BLITZ_SECTIONS) {
      expect(phaseKeys.has(s.phase)).toBe(true);
    }
    expect(BLITZ_PHASE_ORDER).toEqual(["intro", "build", "test", "scale"]);
  });

  it("keeps per-phase counts consistent with the section list", () => {
    const total = BLITZ_PHASE_ORDER.reduce(
      (sum, key) => sum + BLITZ_PHASE_LESSON_COUNTS[key],
      0,
    );
    expect(total).toBe(BLITZ_SECTION_COUNT);
    for (const key of BLITZ_PHASE_ORDER) {
      expect(BLITZ_PHASE_LESSON_COUNTS[key]).toBe(
        BLITZ_SECTIONS.filter(s => s.phase === key).length,
      );
    }
  });

  it("provides lookups keyed by id and courseId", () => {
    for (const s of BLITZ_SECTIONS) {
      expect(BLITZ_SECTION_BY_ID[s.id]).toBe(s);
      expect(BLITZ_SECTION_BY_COURSE_ID[s.courseId]).toBe(s);
    }
  });

  it("validates courseIds and round-trips ids", () => {
    expect(isValidBlitzCourseId("blitz-hub-step-v2-1")).toBe(true);
    expect(isValidBlitzCourseId("blitz-hub-step-v2-23")).toBe(true);
    expect(isValidBlitzCourseId("blitz-hub-step-v2-24")).toBe(false);
    expect(isValidBlitzCourseId("blitz-hub-step-v2-0")).toBe(false);
    expect(isValidBlitzCourseId("blitz-hub-step-5")).toBe(false);
    expect(isValidBlitzCourseId("quick-start")).toBe(false);
    expect(isValidBlitzCourseId(123)).toBe(false);

    expect(blitzLessonIdFromCourseId("blitz-hub-step-v2-7")).toBe(7);
    expect(blitzLessonIdFromCourseId("blitz-hub-step-v2-99")).toBe(0);
    expect(blitzLessonIdFromCourseId("not-a-course")).toBe(0);
  });

  it("exposes a Postgres SQL pattern derived from the canonical prefix", () => {
    expect(BLITZ_V2_COURSE_ID_SQL_PATTERN).toBe("^blitz-hub-step-v2-[0-9]+$");
    expect(BLITZ_V2_COURSE_ID_SQL_PATTERN).toBe(`^${BLITZ_COURSE_ID_PREFIX}[0-9]+$`);
  });
});
