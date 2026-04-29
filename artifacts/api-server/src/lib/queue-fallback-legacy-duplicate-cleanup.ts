/**
 * One-shot cleanup for legacy duplicate queue-fallback audit rows.
 *
 * Background:
 *   For each queue-fallback event we used to write TWO rows into
 *   `audit_log` — one with `entityType="queue"` (from
 *   `queue-fallback-tracker.ts`) and a second with
 *   `entityType="communication"` (from `communication-service.ts`). We
 *   stopped writing the second row, but every duplicate already in the
 *   table is still sitting there until the rolling 30-day cleanup catches
 *   up. This module provides a one-shot deletion so an operator (or an
 *   on-startup hook, if we ever want one) can immediately drop the
 *   leftovers and free that space.
 *
 * Safety:
 *   - The delete is bounded to the exact pair
 *     `actionType = "queue_fallback"` AND `entityType = "communication"`,
 *     which is the legacy-duplicate signature. The surviving "queue" rows
 *     and any other audit rows are untouched.
 *   - Re-running is a no-op (the second invocation matches zero rows and
 *     returns 0), so the script is safe to schedule, retry, or run by
 *     hand multiple times.
 */

import { db, auditLogTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export const QUEUE_FALLBACK_ACTION_TYPE = "queue_fallback";
export const LEGACY_DUPLICATE_ENTITY_TYPE = "communication";

/**
 * Delete every legacy duplicate queue-fallback row from `audit_log` and
 * return the number of rows removed. Logs a single summary line so the
 * caller (script or operator) gets immediate feedback.
 */
export async function runLegacyQueueFallbackDuplicateCleanup(): Promise<number> {
  const result = await db
    .delete(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actionType, QUEUE_FALLBACK_ACTION_TYPE),
        eq(auditLogTable.entityType, LEGACY_DUPLICATE_ENTITY_TYPE),
      ),
    );
  const deletedCount = result.rowCount ?? 0;
  console.log(
    `[QueueFallbackLegacyDuplicateCleanup] Deleted ${deletedCount} legacy duplicate audit row(s) (actionType="${QUEUE_FALLBACK_ACTION_TYPE}", entityType="${LEGACY_DUPLICATE_ENTITY_TYPE}")`,
  );
  return deletedCount;
}
