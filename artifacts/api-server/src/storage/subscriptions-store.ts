import { db, subscriptionsTable, productsTable, btsOrdersTable, userProductsTable } from "@workspace/db";
import { eq, and, inArray, lte, asc, isNotNull, sql } from "drizzle-orm";

export interface CreateSubscriptionInput {
  userId: number;
  productId: number;
  paymentMethodId: number;
  interval: "monthly" | "yearly";
  amountCents: number;
  currency?: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  nextChargeAt: Date;
}

export interface SubscriptionRow {
  id: number;
  userId: number;
  productId: number;
  paymentMethodId: number;
  status: string;
  interval: string;
  amountCents: number;
  currency: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  nextChargeAt: Date | null;
  retryCount: number;
  nextRetryAt: Date | null;
  lastChargeAttemptAt: Date | null;
  lastFailureReason: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionWithProduct extends SubscriptionRow {
  product: {
    id: number;
    name: string;
    slug: string | null;
  } | null;
}

function toRow(r: typeof subscriptionsTable.$inferSelect): SubscriptionRow {
  return {
    id: r.id,
    userId: r.userId,
    productId: r.productId,
    paymentMethodId: r.paymentMethodId,
    status: r.status,
    interval: r.interval,
    amountCents: r.amountCents,
    currency: r.currency,
    currentPeriodStart: r.currentPeriodStart,
    currentPeriodEnd: r.currentPeriodEnd,
    nextChargeAt: r.nextChargeAt,
    retryCount: r.retryCount,
    nextRetryAt: r.nextRetryAt,
    lastChargeAttemptAt: r.lastChargeAttemptAt,
    lastFailureReason: r.lastFailureReason,
    cancelAtPeriodEnd: r.cancelAtPeriodEnd,
    canceledAt: r.canceledAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<SubscriptionRow> {
  const [row] = await db
    .insert(subscriptionsTable)
    .values({
      userId: input.userId,
      productId: input.productId,
      paymentMethodId: input.paymentMethodId,
      status: "active",
      interval: input.interval,
      amountCents: input.amountCents,
      currency: input.currency ?? "USD",
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      nextChargeAt: input.nextChargeAt,
      retryCount: 0,
    })
    .returning();
  return toRow(row);
}

export async function getSubscriptionForUser(
  id: number,
  userId: number,
): Promise<SubscriptionRow | null> {
  const [row] = await db
    .select()
    .from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.id, id), eq(subscriptionsTable.userId, userId)))
    .limit(1);
  return row ? toRow(row) : null;
}

export async function listSubscriptionsForUser(
  userId: number,
): Promise<SubscriptionWithProduct[]> {
  const rows = await db
    .select({
      sub: subscriptionsTable,
      product: {
        id: productsTable.id,
        name: productsTable.name,
        slug: productsTable.slug,
      },
    })
    .from(subscriptionsTable)
    .leftJoin(productsTable, eq(subscriptionsTable.productId, productsTable.id))
    .where(eq(subscriptionsTable.userId, userId));

  return rows.map(({ sub, product }) => ({
    ...toRow(sub),
    product: product ?? null,
  }));
}

/**
 * Set cancel_at_period_end = true and canceled_at = now.
 * Does NOT revoke access or change next_charge_at — access runs to currentPeriodEnd.
 * Returns null if the subscription doesn't belong to userId.
 */
export async function cancelSubscriptionAtPeriodEnd(
  id: number,
  userId: number,
): Promise<SubscriptionRow | null> {
  const [row] = await db
    .update(subscriptionsTable)
    .set({
      cancelAtPeriodEnd: true,
      canceledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(subscriptionsTable.id, id), eq(subscriptionsTable.userId, userId)))
    .returning();
  return row ? toRow(row) : null;
}

/**
 * Link an order to its subscription by setting subscription_id on the bts_orders row.
 * Called immediately after the subscription row is created, inside the same success path.
 */
export async function linkOrderToSubscription(
  orderId: number,
  subscriptionId: number,
): Promise<void> {
  await db
    .update(btsOrdersTable)
    .set({ subscriptionId })
    .where(eq(btsOrdersTable.id, orderId));
}

/**
 * Returns true if the given payment method is pinned to any active or past_due subscription.
 * Used by the DELETE /billing/payment-methods/:id guard.
 */
export async function isPaymentMethodPinnedToActiveSubscription(
  paymentMethodId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.paymentMethodId, paymentMethodId),
        inArray(subscriptionsTable.status, ["active", "past_due"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * List subscriptions that are due for a recurring renewal charge: status
 * 'active', not flagged to cancel at period end, and next_charge_at at or
 * before `now`. Ordered oldest-due-first and capped at `limit` so a single
 * run is bounded. Past-due subscriptions are intentionally excluded — 6.2a is
 * happy-path only; retry/dunning of past_due subs is 6.2b.
 */
export async function listDueSubscriptions(
  now: Date,
  limit: number,
): Promise<SubscriptionRow[]> {
  const rows = await db
    .select()
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.status, "active"),
        eq(subscriptionsTable.cancelAtPeriodEnd, false),
        lte(subscriptionsTable.nextChargeAt, now),
      ),
    )
    .orderBy(asc(subscriptionsTable.nextChargeAt))
    .limit(limit);
  return rows.map(toRow);
}

/**
 * List past_due subscriptions whose next retry is due: status='past_due',
 * next_retry_at <= now, and NOT scheduled for cancel-at-period-end
 * finalization (cancel_at_period_end=false OR current_period_end > now).
 *
 * Subs with cancel_at_period_end=true whose period has ended are handled by
 * Phase 2b (finalizeOneCancellation) — they must never be retried/charged
 * first. Double-guarded by running Phase 2b before Phase 2a.
 *
 * Ordered oldest-retry-first, capped at `limit`.
 */
export async function listDuePastDueRetries(
  now: Date,
  limit: number,
): Promise<SubscriptionRow[]> {
  const rows = await db
    .select()
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.status, "past_due"),
        isNotNull(subscriptionsTable.nextRetryAt),
        lte(subscriptionsTable.nextRetryAt, now),
        // Exclude rows that should be cancel-finalized instead of retried:
        // those with cancel_at_period_end=true AND current_period_end <= now.
        sql`NOT (${subscriptionsTable.cancelAtPeriodEnd} = true AND ${subscriptionsTable.currentPeriodEnd} <= ${now})`,
      ),
    )
    .orderBy(asc(subscriptionsTable.nextRetryAt))
    .limit(limit);
  return rows.map(toRow);
}

/**
 * List subscriptions that should be finalized as canceled: cancel_at_period_end=true,
 * status in ('active','past_due'), and current_period_end <= now.
 * Used by Phase 2b of processDueRenewals.
 */
export async function listDueForCancellation(
  now: Date,
  limit: number,
): Promise<SubscriptionRow[]> {
  const rows = await db
    .select()
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.cancelAtPeriodEnd, true),
        inArray(subscriptionsTable.status, ["active", "past_due"]),
        lte(subscriptionsTable.currentPeriodEnd, now),
      ),
    )
    .orderBy(asc(subscriptionsTable.currentPeriodEnd))
    .limit(limit);
  return rows.map(toRow);
}

/**
 * Advance a subscription to its next billing period after a successful renewal
 * charge. The new period starts where the old one ended (periods stay
 * contiguous regardless of when the charge actually ran) and next_charge_at
 * moves to the new period end. Resets retry_count, clears next_retry_at and
 * the last failure reason, and ensures status='active' (used both for normal
 * renewal and for dunning recovery from past_due). Called ONLY from inside the
 * checkout core's onOrderPaid callback, so the per-period idempotency key
 * guarantees it runs at most once per period.
 */
export async function advanceSubscriptionPeriod(
  id: number,
  params: { newPeriodStart: Date; newPeriodEnd: Date; attemptedAt: Date },
): Promise<SubscriptionRow | null> {
  const [row] = await db
    .update(subscriptionsTable)
    .set({
      status: "active",
      currentPeriodStart: params.newPeriodStart,
      currentPeriodEnd: params.newPeriodEnd,
      nextChargeAt: params.newPeriodEnd,
      retryCount: 0,
      nextRetryAt: null,
      lastChargeAttemptAt: params.attemptedAt,
      lastFailureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.id, id))
    .returning();
  return row ? toRow(row) : null;
}

/**
 * Mark a subscription past_due after a declined renewal charge and arm the
 * dunning retry schedule. Sets retry_count=1 and next_retry_at=now+3d so
 * Phase 2a picks up the first retry attempt. Idempotent: re-running on an
 * already past_due sub (detected by retry_count > 0) refreshes only the
 * reason/timestamp, not the retry schedule, to avoid re-arming.
 * The period is NOT advanced, so next_charge_at stays in the past for 6.2b to
 * pick up.
 */
export async function markSubscriptionPastDue(
  id: number,
  params: { reason: string; attemptedAt: Date },
): Promise<SubscriptionRow | null> {
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const nextRetryAt = new Date(params.attemptedAt.getTime() + THREE_DAYS_MS);

  // Use a conditional update so re-running on an already past_due sub (retry_count > 0)
  // only updates the failure metadata — it does NOT reset next_retry_at or retry_count.
  const [alreadyPastDue] = await db
    .select({ id: subscriptionsTable.id, retryCount: subscriptionsTable.retryCount })
    .from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.id, id), eq(subscriptionsTable.status, "past_due")))
    .limit(1);

  if (alreadyPastDue) {
    // Already past_due — refresh metadata only; do not re-arm the schedule.
    const [row] = await db
      .update(subscriptionsTable)
      .set({
        lastChargeAttemptAt: params.attemptedAt,
        lastFailureReason: params.reason,
        updatedAt: new Date(),
      })
      .where(eq(subscriptionsTable.id, id))
      .returning();
    return row ? toRow(row) : null;
  }

  // First decline — arm the retry schedule.
  const [row] = await db
    .update(subscriptionsTable)
    .set({
      status: "past_due",
      retryCount: 1,
      nextRetryAt,
      lastChargeAttemptAt: params.attemptedAt,
      lastFailureReason: params.reason,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.id, id))
    .returning();
  return row ? toRow(row) : null;
}

/**
 * Advance the dunning retry schedule after a declined retry attempt.
 * Increments retry_count and schedules the next retry so the cadence from the
 * original failure is maintained: +3d (attempt #2) → +7d (attempt #3 = final).
 * The caller passes the new retry_count after incrementing.
 */
export async function advanceDunningSchedule(
  id: number,
  params: { newRetryCount: number; nextRetryAt: Date; reason: string; attemptedAt: Date },
): Promise<SubscriptionRow | null> {
  const [row] = await db
    .update(subscriptionsTable)
    .set({
      retryCount: params.newRetryCount,
      nextRetryAt: params.nextRetryAt,
      lastChargeAttemptAt: params.attemptedAt,
      lastFailureReason: params.reason,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.id, id))
    .returning();
  return row ? toRow(row) : null;
}

/**
 * Mark a subscription unpaid after the final dunning attempt fails. Clears
 * next_retry_at. Access revocation must be done separately (caller's
 * responsibility so this remains a pure state transition).
 */
export async function markSubscriptionUnpaid(
  id: number,
  params: { reason: string; attemptedAt: Date },
): Promise<SubscriptionRow | null> {
  const [row] = await db
    .update(subscriptionsTable)
    .set({
      status: "unpaid",
      nextRetryAt: null,
      lastChargeAttemptAt: params.attemptedAt,
      lastFailureReason: params.reason,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.id, id))
    .returning();
  return row ? toRow(row) : null;
}

/**
 * Finalize a cancel_at_period_end subscription at period end: sets
 * status='canceled', clears next_charge_at and next_retry_at, preserves
 * canceled_at. Access revocation must be done separately.
 */
export async function finalizeSubscriptionCanceled(
  id: number,
): Promise<SubscriptionRow | null> {
  const [row] = await db
    .update(subscriptionsTable)
    .set({
      status: "canceled",
      nextChargeAt: null,
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.id, id))
    .returning();
  return row ? toRow(row) : null;
}

/**
 * Revoke the active user_products grant for a specific (userId, productId)
 * pair — used when a subscription ends (final dunning failure or
 * cancel-at-period-end finalization). Only touches the single active grant for
 * THIS subscription's product; other products the member owns are unaffected.
 * Idempotent: if the grant is already cancelled, this is a no-op.
 */
export async function revokeSubscriptionGrant(
  userId: number,
  productId: number,
): Promise<{ revoked: boolean }> {
  const updated = await db
    .update(userProductsTable)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(userProductsTable.userId, userId),
        eq(userProductsTable.productId, productId),
        eq(userProductsTable.status, "active"),
      ),
    )
    .returning({ id: userProductsTable.id });
  return { revoked: updated.length > 0 };
}

/**
 * Returns true if the user already has an active or past_due subscription for this product.
 */
export async function hasActiveSubscription(
  userId: number,
  productId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.userId, userId),
        eq(subscriptionsTable.productId, productId),
        inArray(subscriptionsTable.status, ["active", "past_due"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
