import { db, checkoutIdempotencyTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Drizzle wraps PostgreSQL errors in a DrizzleQueryError — the PG error code
 * lives on `.cause.code`, not directly on the thrown object.
 */
function isPgUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}

export type IdempotencyClaimResult =
  | { type: "claimed" }
  | { type: "replay"; result: unknown; wasSuccess: boolean }
  | { type: "in_progress" }
  | { type: "conflict" };

export type IdempotencyPeekResult =
  | { type: "not_found" }
  | { type: "replay"; result: unknown; wasSuccess: boolean }
  | { type: "in_progress" }
  | { type: "conflict" };

function buildReplayWasSuccess(result: Record<string, unknown>): boolean {
  const outcomeType = result?.outcomeType as string | undefined;
  return (
    outcomeType === "paid" ||
    outcomeType === "paid_reconciliation_needed" ||
    // Legacy fallback: rows completed before outcomeType was introduced
    (outcomeType === undefined && (result?.status as string) === "paid")
  );
}

/**
 * Read-only peek at an idempotency key — no writes, no side effects.
 *
 * Use this BEFORE any validation that should not run on replays (e.g. saved-card
 * ownership lookup), so that an already-completed key can short-circuit and
 * replay its stored outcome even if the card was subsequently deleted.
 *
 * Returns { type: "not_found" } for genuinely fresh attempts; the caller should
 * then proceed with validation and call claimIdempotencyKey.
 */
export async function peekIdempotencyKey(
  idempotencyKey: string,
  userId: number,
  productId: number,
): Promise<IdempotencyPeekResult> {
  const [existing] = await db
    .select()
    .from(checkoutIdempotencyTable)
    .where(eq(checkoutIdempotencyTable.idempotencyKey, idempotencyKey))
    .limit(1);

  if (!existing) {
    return { type: "not_found" };
  }

  if (existing.userId !== userId || existing.productId !== productId) {
    return { type: "conflict" };
  }

  if (existing.status === "in_progress") {
    return { type: "in_progress" };
  }

  const result = existing.result as Record<string, unknown>;
  return { type: "replay", result, wasSuccess: buildReplayWasSuccess(result) };
}

/**
 * Claim an idempotency key for a checkout attempt.
 *
 * Semantics:
 *  - Key does not exist → INSERT in_progress row, return { type: "claimed" }.
 *  - Key exists + completed + same (user, product) → return stored result (no second charge).
 *  - Key exists + in_progress + same (user, product) → return { type: "in_progress" } (409 signal).
 *  - Key exists (any status) + different (user, product) → return { type: "conflict" } (409 signal).
 *
 * Call this only after peekIdempotencyKey returned { type: "not_found" } and all
 * pre-charge validation has passed, so that validation failures never consume a key.
 */
export async function claimIdempotencyKey(
  idempotencyKey: string,
  userId: number,
  productId: number,
): Promise<IdempotencyClaimResult> {
  try {
    await db.insert(checkoutIdempotencyTable).values({
      idempotencyKey,
      userId,
      productId,
      status: "in_progress",
    });
    return { type: "claimed" };
  } catch (err: unknown) {
    if (!isPgUniqueViolation(err)) {
      throw err;
    }
  }

  const [existing] = await db
    .select()
    .from(checkoutIdempotencyTable)
    .where(eq(checkoutIdempotencyTable.idempotencyKey, idempotencyKey))
    .limit(1);

  if (!existing) {
    throw new Error("Idempotency row vanished between insert conflict and re-read");
  }

  if (existing.userId !== userId || existing.productId !== productId) {
    return { type: "conflict" };
  }

  if (existing.status === "in_progress") {
    return { type: "in_progress" };
  }

  const result = existing.result as Record<string, unknown>;
  return { type: "replay", result, wasSuccess: buildReplayWasSuccess(result) };
}

/**
 * Mark an idempotency key as completed, linking the order and storing the
 * final result JSON.  Should be called exactly once per claimed key regardless
 * of whether the charge succeeded or failed.
 */
export async function completeIdempotencyKey(
  idempotencyKey: string,
  orderId: number | null,
  result: Record<string, unknown>,
): Promise<void> {
  await db
    .update(checkoutIdempotencyTable)
    .set({
      status: "completed",
      orderId,
      result,
      completedAt: new Date(),
    })
    .where(eq(checkoutIdempotencyTable.idempotencyKey, idempotencyKey));
}
