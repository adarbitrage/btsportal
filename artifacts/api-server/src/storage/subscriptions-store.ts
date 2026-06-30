import { db, subscriptionsTable, productsTable, btsOrdersTable } from "@workspace/db";
import { eq, and, inArray, lte, asc } from "drizzle-orm";

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
 * Advance a subscription to its next billing period after a successful renewal
 * charge. The new period starts where the old one ended (periods stay
 * contiguous regardless of when the charge actually ran) and next_charge_at
 * moves to the new period end. Resets retry_count and clears the last failure
 * reason. Called ONLY from inside the checkout core's onOrderPaid callback, so
 * the per-period idempotency key guarantees it runs at most once per period.
 */
export async function advanceSubscriptionPeriod(
  id: number,
  params: { newPeriodStart: Date; newPeriodEnd: Date; attemptedAt: Date },
): Promise<SubscriptionRow | null> {
  const [row] = await db
    .update(subscriptionsTable)
    .set({
      currentPeriodStart: params.newPeriodStart,
      currentPeriodEnd: params.newPeriodEnd,
      nextChargeAt: params.newPeriodEnd,
      retryCount: 0,
      lastChargeAttemptAt: params.attemptedAt,
      lastFailureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.id, id))
    .returning();
  return row ? toRow(row) : null;
}

/**
 * Mark a subscription past_due after a declined renewal charge. Records the
 * attempt timestamp and the raw failure reason and STOPS — no retry, dunning,
 * or access revocation (that is 6.2b). Idempotent: re-running on an already
 * past_due sub simply refreshes the reason/timestamp. The period is NOT
 * advanced, so next_charge_at stays in the past for 6.2b to pick up.
 */
export async function markSubscriptionPastDue(
  id: number,
  params: { reason: string; attemptedAt: Date },
): Promise<SubscriptionRow | null> {
  const [row] = await db
    .update(subscriptionsTable)
    .set({
      status: "past_due",
      lastChargeAttemptAt: params.attemptedAt,
      lastFailureReason: params.reason,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.id, id))
    .returning();
  return row ? toRow(row) : null;
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
