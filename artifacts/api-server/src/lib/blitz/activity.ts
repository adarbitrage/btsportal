/**
 * Blitz activity timeline fetcher
 *
 * Returns the most recent activity events for a user, enriched with
 * canonical section metadata where available.
 *
 * Current implementation: reads from `course_progress` (the table that
 * exists today) because `blitz_progress_events` (Task 2) has not been
 * created yet.  When Task 2 ships, update this module to query
 * `blitz_progress_events` ordered by `occurred_at DESC` — the return
 * type contract is unchanged so callers (e.g. the coach dashboard) won't
 * need updating.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { BLITZ_SECTION_BY_COURSE_ID } from "./sections";

export type ActivityEventType = "completed" | "viewed" | "uncompleted";

export interface ActivityEvent {
  courseId: string;
  /** Section id if the courseId is a recognised Blitz v2 section. */
  sectionId: number | null;
  /** Human-readable section name, or raw courseId for non-Blitz courses. */
  name: string;
  /** Phase label (e.g. "Phase 1 — Build") or null for non-Blitz courses. */
  phase: string | null;
  eventType: ActivityEventType;
  occurredAt: string;
}

/**
 * Fetch the most recent `limit` activity events for a user across ALL
 * course types (blitz v2, legacy blitz, and any other courseIds).
 *
 * @param userId   - member to load
 * @param limit    - max events to return (default 20)
 */
export async function fetchRecentActivity(
  userId: number,
  limit = 20,
): Promise<ActivityEvent[]> {
  const rows = await db.execute(sql`
    SELECT course_id, completed_at
    FROM course_progress
    WHERE user_id = ${userId}
    ORDER BY completed_at DESC
    LIMIT ${limit}
  `);

  return (rows.rows as Array<{ course_id: string; completed_at: Date }>).map(row => {
    const section = BLITZ_SECTION_BY_COURSE_ID[row.course_id];
    return {
      courseId: row.course_id,
      sectionId: section?.id ?? null,
      name: section?.title ?? row.course_id,
      phase: section ? sectionPhaseLabel(section.phase) : null,
      eventType: "completed" as ActivityEventType,
      occurredAt: new Date(row.completed_at).toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<string, string> = {
  intro: "Introduction",
  build: "Phase 1 — Build",
  test:  "Phase 2 — Test",
  scale: "Phase 3 — Scale",
};

function sectionPhaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}
