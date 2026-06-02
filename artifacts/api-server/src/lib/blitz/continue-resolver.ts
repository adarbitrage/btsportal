/**
 * Blitz continue-resolver
 *
 * Determines exactly where a user left off in the Blitz curriculum and
 * returns a rich section descriptor for API responses.
 *
 * Contract (mirrors Task 2 spec for `/api/blitz/continue`):
 *   - "new"       — no progress at all → Section 1
 *   - "in_progress" — most recent event was `viewed` → that section + saved position
 *   - "returning"   — most recent event was `completed` → next section in order
 *
 * Current implementation: falls back to `course_progress` completions because
 * the `blitz_progress_events` table (Task 2) does not yet exist.  When Task 2
 * ships, replace the body of `resolveCurrentSection` to query
 * `blitz_progress_events` ordered by `occurred_at DESC` — the return type
 * contract is unchanged so callers won't need updating.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  BLITZ_SECTIONS,
  BLITZ_SECTION_BY_ID,
  BLITZ_SECTION_COUNT,
  BLITZ_PHASE_MAP,
  type BlitzSection,
} from "./sections";

export interface CurrentSectionResult {
  /** Section object — null only if the user has completed every section. */
  section: {
    id: number;
    courseId: string;
    name: string;
    step: string;
    phase: string;
  } | null;
  /** Resume status. */
  status: "new" | "in_progress" | "returning" | "completed";
}

/**
 * Resolve the current / next section for a single user.
 *
 * @param userId — the member whose progress to inspect
 * @param completedCourseIds — optional pre-fetched set of completed courseIds;
 *        when omitted the function queries the DB itself (handy for single-user
 *        detail endpoints; pass the set when doing bulk resolution to avoid
 *        per-user queries).
 */
export async function resolveCurrentSection(
  userId: number,
  completedCourseIds?: ReadonlySet<string>,
): Promise<CurrentSectionResult> {
  let completed: ReadonlySet<string>;

  if (completedCourseIds !== undefined) {
    completed = completedCourseIds;
  } else {
    const rows = await db.execute(sql`
      SELECT course_id
      FROM course_progress
      WHERE user_id = ${userId}
        AND course_id ~ '^blitz-hub-step-v2-[0-9]+$'
    `);
    completed = new Set((rows.rows as Array<{ course_id: string }>).map(r => r.course_id));
  }

  if (completed.size === 0) {
    return {
      section: formatSection(BLITZ_SECTIONS[0]),
      status: "new",
    };
  }

  if (completed.size >= BLITZ_SECTION_COUNT) {
    return { section: null, status: "completed" };
  }

  // Find the first section not yet completed — this is "next" (returning).
  // (blitz_progress_events would let us detect "in_progress" via a `viewed`
  //  event without a matching `completed` event; using course_progress we can
  //  only distinguish "returning" from "new".)
  const next = BLITZ_SECTIONS.find(s => !completed.has(s.courseId));
  if (!next) {
    return { section: null, status: "completed" };
  }

  return {
    section: formatSection(next),
    status: "returning",
  };
}

/**
 * Bulk-resolve current sections for many users in a single DB round-trip.
 * Returns a Map of userId → CurrentSectionResult.
 */
export async function resolveCurrentSectionBulk(
  userIds: number[],
): Promise<Map<number, CurrentSectionResult>> {
  if (userIds.length === 0) return new Map();

  // Pass the ids as a single Postgres array literal (e.g. "{1,2,3}") cast to
  // int[]. Interpolating the JS array directly (`ANY(${userIds}::int[])`) makes
  // drizzle expand it into a comma-separated parameter list, which Postgres
  // reads as a record cast and rejects with "cannot cast type record to
  // integer[]". userIds are DB-sourced integers, so the literal is injection-safe.
  const idArrayLiteral = `{${userIds.join(",")}}`;

  const rows = await db.execute(sql`
    SELECT user_id, course_id
    FROM course_progress
    WHERE user_id = ANY(${idArrayLiteral}::int[])
      AND course_id ~ '^blitz-hub-step-v2-[0-9]+$'
  `);

  // Group completions by user
  const byUser = new Map<number, Set<string>>();
  for (const row of rows.rows as Array<{ user_id: number; course_id: string }>) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, new Set());
    byUser.get(row.user_id)!.add(row.course_id);
  }

  const results = new Map<number, CurrentSectionResult>();
  for (const userId of userIds) {
    const completedSet = byUser.get(userId) ?? new Set<string>();

    if (completedSet.size === 0) {
      results.set(userId, { section: formatSection(BLITZ_SECTIONS[0]), status: "new" });
      continue;
    }
    if (completedSet.size >= BLITZ_SECTION_COUNT) {
      results.set(userId, { section: null, status: "completed" });
      continue;
    }
    const next = BLITZ_SECTIONS.find(s => !completedSet.has(s.courseId));
    results.set(userId, {
      section: next ? formatSection(next) : null,
      status: next ? "returning" : "completed",
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSection(s: BlitzSection) {
  const phase = BLITZ_PHASE_MAP[s.phase];
  return {
    id: s.id,
    courseId: s.courseId,
    name: s.title,
    step: s.step,
    phase: phase.label,
  };
}
