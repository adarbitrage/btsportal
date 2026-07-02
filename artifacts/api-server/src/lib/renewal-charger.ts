/**
 * NMI recurring renewal charger (Tier 6.2a happy path + Tier 6.2b dunning).
 *
 * `processDueRenewals` is a pure, directly-callable function (it takes an
 * optional `now` + `maxPerRun` and returns a per-run tally), so it can be
 * driven by a test, a one-off script, or the hourly BullMQ scheduler below.
 *
 * Phase 1 (6.2a): charge active-due subscriptions. On success: advance period
 * + extend access. On decline: mark past_due, arm dunning schedule (+3d first
 * retry), queue "first payment failure" email. Access stays ON during dunning.
 *
 * Phase 2b (6.2b) — runs FIRST: finalize cancel_at_period_end subscriptions
 * whose period has ended — set canceled, revoke grant, no charge, no email.
 * Must precede Phase 2a so a past_due+cancel_at_period_end row is canceled,
 * never retried/charged. Phase 2a also excludes such rows from its query.
 *
 * Phase 2a (6.2b) — runs SECOND: retry past_due subscriptions whose
 * next_retry_at <= now (and not cancel-finalizable per Phase 2b).
 *   - Attempt #2 (+3d): idempotency key `..._retry_1`. On success: recover
 *     (active, advance period, extend grant). On decline: advance to +7d cadence
 *     (retry_count=2, next_retry_at=now+4d). No email.
 *   - Attempt #3 (+7d): idempotency key `..._retry_2`. On success: recover.
 *     On decline: mark unpaid, revoke grant, queue "final failure" email.
 *
 * A single `maxPerRun` budget spans all three phases collectively. Each
 * subscription is isolated so one bad row never aborts the batch.
 *
 * Money safety is borrowed wholesale from the audited checkout core —
 * deterministic per-period idempotency key guards each distinct charge, and
 * per-attempt retry keys make each retry idempotent within its retry slot.
 */

import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { db, usersTable, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { QUEUE_REDIS_OPTIONS, makeThrottledRedisErrorLogger } from "./redis";
import { recordChargerRun } from "./billing-heartbeat";
import { queueBillingAlert } from "./billing-alerts";
import { runCheckoutCore } from "./payments/checkout-core";
import { extendActiveGrantExpiry } from "./external-grant-product";
import { getPaymentMethodForUser } from "../storage/payment-methods-store";
import {
  listDueSubscriptions,
  listDuePastDueRetries,
  listDueForCancellation,
  advanceSubscriptionPeriod,
  markSubscriptionPastDue,
  advanceDunningSchedule,
  markSubscriptionUnpaid,
  finalizeSubscriptionCanceled,
  revokeSubscriptionGrant,
  type SubscriptionRow,
} from "../storage/subscriptions-store";
import { CommunicationService } from "./communication-service";

const DEFAULT_MAX_PER_RUN = 200;

export interface ProcessDueRenewalsResult {
  /** Subscriptions selected and attempted this run (all phases). */
  processed: number;
  /** Renewals charged (or replayed as paid) and advanced. */
  succeeded: number;
  /** Renewals declined → subscription marked past_due or dunning advanced. */
  declined: number;
  /** Subscriptions that threw an unexpected error (isolated, batch continues). */
  errored: number;
  /** In-progress / conflict / reconciliation outcomes — left for a later run. */
  skipped: number;
  /** Subscriptions finalized as canceled (cancel_at_period_end + period ended). */
  canceled: number;
  /** Subscriptions where dunning exhausted all retries → unpaid + revoked. */
  revoked: number;
}

function resolveMaxPerRun(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const fromEnv = Number(process.env.RENEWAL_MAX_PER_RUN);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.floor(fromEnv);
  }
  return DEFAULT_MAX_PER_RUN;
}

function addInterval(start: Date, interval: string): Date {
  const end = new Date(start);
  if (interval === "yearly") {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

type RenewalOutcome = "succeeded" | "declined" | "skipped";

/** Fetch the user's email + name for a subscription. Returns null if the user is gone. */
async function resolveUser(
  userId: number,
): Promise<{ email: string; name: string } | null> {
  const [user] = await db
    .select({ email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return user ?? null;
}

/** Fetch a product's name for email variables. Returns the id as a fallback. */
async function resolveProductName(productId: number): Promise<string> {
  const [p] = await db
    .select({ name: productsTable.name })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  return p?.name ?? `Product #${productId}`;
}

/**
 * Queue the first payment failure email (attempt #1 declined).
 * Soft failure: log, do not throw.
 */
async function sendPaymentFailedEmail(params: {
  email: string;
  memberName: string;
  productName: string;
  userId: number;
}): Promise<void> {
  try {
    await CommunicationService.queueEmail({
      templateSlug: "payment_failed",
      to: params.email,
      userId: params.userId,
      category: "billing",
      variables: {
        member_name: params.memberName,
        product_name: params.productName,
        // grace_date is not meaningful in the dunning model (no fixed grace
        // cutoff) — pass an empty string so the template renders without error.
        grace_date: "",
      },
    });
  } catch (err) {
    console.error("[RenewalCharger] Failed to queue payment_failed email:", err);
  }
}

/**
 * Queue the final dunning failure email (all attempts exhausted, access ended).
 * Soft failure: log, do not throw.
 */
async function sendPaymentFailedFinalEmail(params: {
  email: string;
  memberName: string;
  productName: string;
  userId: number;
}): Promise<void> {
  try {
    await CommunicationService.queueEmail({
      templateSlug: "payment_failed_final",
      to: params.email,
      userId: params.userId,
      category: "billing",
      variables: {
        member_name: params.memberName,
        product_name: params.productName,
      },
    });
  } catch (err) {
    console.error("[RenewalCharger] Failed to queue payment_failed_final email:", err);
  }
}

// ─── Phase 1: charge an active subscription due for renewal ─────────────────

/**
 * Charge a single due subscription's renewal. Uses the deterministic
 * per-period idempotency key (`sub_{id}_period_{periodEndISO}`) so a
 * double-run charges the card at most once per period.
 *
 * On decline: marks the subscription past_due, arms the dunning schedule
 * (retry_count=1, next_retry_at=now+3d), and queues the "payment failed" email.
 */
async function chargeOneRenewal(sub: SubscriptionRow, now: Date): Promise<RenewalOutcome> {
  const method = await getPaymentMethodForUser(sub.paymentMethodId, sub.userId);
  if (!method) {
    await markSubscriptionPastDue(sub.id, {
      reason: "Pinned payment method not found",
      attemptedAt: now,
    });
    console.error(
      `[RenewalCharger] sub ${sub.id}: pinned payment method ${sub.paymentMethodId} ` +
      `not found for user ${sub.userId} — marked past_due.`,
    );
    return "declined";
  }

  const user = await resolveUser(sub.userId);
  if (!user) {
    await markSubscriptionPastDue(sub.id, {
      reason: "Subscriber user not found",
      attemptedAt: now,
    });
    console.error(
      `[RenewalCharger] sub ${sub.id}: user ${sub.userId} not found — marked past_due.`,
    );
    return "declined";
  }

  const periodEnd = sub.currentPeriodEnd;
  const newPeriodStart = periodEnd;
  const newPeriodEnd = addInterval(periodEnd, sub.interval);
  const idempotencyKey = `sub_${sub.id}_period_${periodEnd.toISOString()}`;

  const core = await runCheckoutCore({
    userId: sub.userId,
    productId: sub.productId,
    email: user.email,
    idempotencyKey,
    amountCents: sub.amountCents,
    currency: sub.currency,
    orderType: "recurring_renewal",
    subscriptionId: sub.id,
    grantEntitlements: false,
    entitlementKeys: [],
    durationDays: null,
    lineItemDescription: "Subscription renewal",
    resolvedVaultId: method.vaultId,
    onOrderPaid: async () => {
      await advanceSubscriptionPeriod(sub.id, {
        newPeriodStart,
        newPeriodEnd,
        attemptedAt: now,
      });
      await extendActiveGrantExpiry({
        userId: sub.userId,
        productId: sub.productId,
        newExpiresAt: newPeriodEnd,
        externalSource: "nmi",
        externalOrderId: `renewal-sub-${sub.id}-${periodEnd.toISOString()}`,
      });
      return { subscriptionId: sub.id, newPeriodEnd: newPeriodEnd.toISOString() };
    },
  });

  switch (core.type) {
    case "paid":
    case "replay_paid":
      return "succeeded";
    case "declined": {
      const reason = core.declineReason ?? core.message ?? "Card declined";
      await markSubscriptionPastDue(sub.id, { reason, attemptedAt: now });
      // Queue first-failure email only on a fresh decline — not on replay.
      const productName = await resolveProductName(sub.productId);
      await sendPaymentFailedEmail({
        email: user.email,
        memberName: user.name,
        productName,
        userId: sub.userId,
      });
      return "declined";
    }
    case "replay_declined": {
      // A re-run of the same period already declined — state already set,
      // email already queued. Nothing to do.
      return "declined";
    }
    case "paid_reconciliation_needed":
    case "replay_reconciliation_needed":
      console.error(
        `[RenewalCharger] sub ${sub.id}: order ${core.orderNumber} needs manual reconciliation.`,
      );
      return "skipped";
    case "in_progress":
    case "conflict":
      return "skipped";
    default: {
      const _exhaustive: never = core;
      void _exhaustive;
      return "skipped";
    }
  }
}

// ─── Phase 2a: dunning retry ─────────────────────────────────────────────────

/**
 * Attempt a dunning retry for a past_due subscription.
 *
 * The idempotency key is per-attempt: `sub_{id}_period_{periodEnd}_retry_{retryCount}`
 * where `retryCount` is the CURRENT value (set by the previous decline).
 *   retry_count=1 → attempt #2  (first retry, +3d cadence)
 *   retry_count=2 → attempt #3  (final retry, +7d cadence)
 *
 * On success: recover the subscription to active (advance period, extend grant).
 * On decline (retry_count=1 → attempt #2): advance to next slot (retry_count=2,
 *   next_retry_at = now+4d so total offset from original failure = 7d). No email.
 * On final decline (retry_count=2 → attempt #3): mark unpaid, revoke grant,
 *   queue payment_failed_final email.
 */
async function chargeOneRetry(
  sub: SubscriptionRow,
  now: Date,
): Promise<"succeeded" | "declined_advance" | "declined_final" | "skipped"> {
  const method = await getPaymentMethodForUser(sub.paymentMethodId, sub.userId);
  const user = await resolveUser(sub.userId);

  if (!method || !user) {
    // Cannot charge without a card or user. Treat as a decline and follow the
    // dunning schedule rather than forcing unpaid immediately — this preserves
    // the due→+3d→+7d cadence and only exhausts dunning at the final attempt.
    const reason = !method ? "Pinned payment method not found" : "Subscriber user not found";
    const isFinal = sub.retryCount >= 2;

    if (isFinal) {
      await markSubscriptionUnpaid(sub.id, { reason, attemptedAt: now });
      await revokeSubscriptionGrant(sub.userId, sub.productId);
      if (user) {
        const productName = await resolveProductName(sub.productId);
        await sendPaymentFailedFinalEmail({
          email: user.email,
          memberName: user.name,
          productName,
          userId: sub.userId,
        });
      }
      console.error(
        `[RenewalCharger] sub ${sub.id}: ${reason} on final retry — marked unpaid/revoked.`,
      );
      return "declined_final";
    }

    // Not the final attempt — advance the dunning schedule.
    const newRetryCount = sub.retryCount + 1;
    const scheduleAnchor = sub.nextRetryAt ?? now;
    const nextRetryAt = addDays(scheduleAnchor, 4);
    await advanceDunningSchedule(sub.id, {
      newRetryCount,
      nextRetryAt,
      reason,
      attemptedAt: now,
    });
    console.error(
      `[RenewalCharger] sub ${sub.id}: ${reason} on retry #${sub.retryCount} — ` +
      `advanced dunning to retry_count=${newRetryCount}, next_retry_at=${nextRetryAt.toISOString()}.`,
    );
    return "declined_advance";
  }

  const currentRetryCount = sub.retryCount; // 1 or 2
  const periodEnd = sub.currentPeriodEnd;
  const newPeriodStart = periodEnd;
  const newPeriodEnd = addInterval(periodEnd, sub.interval);

  // Per-attempt key: `sub_{id}_period_{periodEnd}_retry_{currentRetryCount}`.
  // A re-run of the same tick replays the outcome without re-charging.
  const idempotencyKey =
    `sub_${sub.id}_period_${periodEnd.toISOString()}_retry_${currentRetryCount}`;

  const core = await runCheckoutCore({
    userId: sub.userId,
    productId: sub.productId,
    email: user.email,
    idempotencyKey,
    amountCents: sub.amountCents,
    currency: sub.currency,
    orderType: "recurring_renewal",
    subscriptionId: sub.id,
    grantEntitlements: false,
    entitlementKeys: [],
    durationDays: null,
    lineItemDescription: "Subscription renewal (retry)",
    resolvedVaultId: method.vaultId,
    onOrderPaid: async () => {
      // Recovery: advance the period and restore the grant exactly as a
      // normal renewal would. advanceSubscriptionPeriod sets status='active'
      // and clears next_retry_at.
      await advanceSubscriptionPeriod(sub.id, {
        newPeriodStart,
        newPeriodEnd,
        attemptedAt: now,
      });
      await extendActiveGrantExpiry({
        userId: sub.userId,
        productId: sub.productId,
        newExpiresAt: newPeriodEnd,
        externalSource: "nmi",
        externalOrderId: `renewal-sub-${sub.id}-${periodEnd.toISOString()}-retry-${currentRetryCount}`,
      });
      return {
        subscriptionId: sub.id,
        newPeriodEnd: newPeriodEnd.toISOString(),
        recoveredFromDunning: true,
      };
    },
  });

  switch (core.type) {
    case "paid":
    case "replay_paid":
      return "succeeded";

    case "declined": {
      const reason = core.declineReason ?? core.message ?? "Card declined";
      const isFinal = currentRetryCount >= 2;

      if (isFinal) {
        // Attempt #3 failed — exhaust dunning, revoke access.
        await markSubscriptionUnpaid(sub.id, { reason, attemptedAt: now });
        await revokeSubscriptionGrant(sub.userId, sub.productId);
        const productName = await resolveProductName(sub.productId);
        // Queue final-failure email only on a fresh decline — not on replay.
        await sendPaymentFailedFinalEmail({
          email: user.email,
          memberName: user.name,
          productName,
          userId: sub.userId,
        });
        return "declined_final";
      }

      // Attempt #2 failed — advance cadence to +7d from original failure.
      // Anchor to the seeded schedule (sub.nextRetryAt = original_failure + 3d)
      // rather than execution time, so a late-running worker never extends grace
      // beyond the intended due→+3d→+7d window.
      const newRetryCount = currentRetryCount + 1;
      const scheduleAnchor = sub.nextRetryAt ?? now;
      const nextRetryAt = addDays(scheduleAnchor, 4);
      await advanceDunningSchedule(sub.id, {
        newRetryCount,
        nextRetryAt,
        reason,
        attemptedAt: now,
      });
      return "declined_advance";
    }
    case "replay_declined": {
      // A re-run of the same retry slot already declined — state already set,
      // email already queued. Nothing to do.
      const isFinal = currentRetryCount >= 2;
      return isFinal ? "declined_final" : "declined_advance";
    }

    case "paid_reconciliation_needed":
    case "replay_reconciliation_needed":
      console.error(
        `[RenewalCharger] sub ${sub.id}: retry order ${core.orderNumber} needs manual reconciliation.`,
      );
      return "skipped";

    case "in_progress":
    case "conflict":
      return "skipped";

    default: {
      const _exhaustive: never = core;
      void _exhaustive;
      return "skipped";
    }
  }
}

// ─── Phase 2b: cancel finalization ───────────────────────────────────────────

/**
 * Finalize a subscription that was set to cancel at period end and whose
 * period has now elapsed. Sets status='canceled', revokes the grant. No charge,
 * no email (the member initiated the cancellation and already received confirmation).
 */
async function finalizeOneCancellation(
  sub: SubscriptionRow,
): Promise<"canceled" | "skipped"> {
  try {
    await finalizeSubscriptionCanceled(sub.id);
    await revokeSubscriptionGrant(sub.userId, sub.productId);
    return "canceled";
  } catch (err) {
    console.error(`[RenewalCharger] sub ${sub.id}: cancel finalization threw:`, err);
    return "skipped";
  }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Process every subscription due for renewal at `now` (default: current time),
 * up to `maxPerRun` (default: RENEWAL_MAX_PER_RUN env or 200). Pure and
 * directly callable — no Redis/queue dependency.
 *
 * Runs all three phases in order:
 *   Phase 1: active subscriptions due for a new charge
 *   Phase 2a: past_due subscriptions whose next_retry_at has elapsed
 *   Phase 2b: cancel_at_period_end subscriptions whose period has ended
 *
 * The budget (`maxPerRun`) is shared across all phases so no single phase can
 * monopolise the run.
 */
export async function processDueRenewals(
  opts: { now?: Date; maxPerRun?: number } = {},
): Promise<ProcessDueRenewalsResult> {
  const now = opts.now ?? new Date();
  const maxPerRun = resolveMaxPerRun(opts.maxPerRun);

  const result: ProcessDueRenewalsResult = {
    processed: 0,
    succeeded: 0,
    declined: 0,
    errored: 0,
    skipped: 0,
    canceled: 0,
    revoked: 0,
  };

  // ── Phase 1: active renewals ──────────────────────────────────────────────
  const remaining1 = maxPerRun - result.processed;
  if (remaining1 > 0) {
    const due = await listDueSubscriptions(now, remaining1);
    for (const sub of due) {
      result.processed++;
      try {
        const outcome = await chargeOneRenewal(sub, now);
        if (outcome === "succeeded") result.succeeded++;
        else if (outcome === "declined") result.declined++;
        else result.skipped++;
      } catch (err) {
        result.errored++;
        console.error(`[RenewalCharger] Phase 1 sub ${sub.id} threw unexpectedly:`, err);
      }
    }
  }

  // ── Phase 2b: cancel finalization (runs BEFORE retries) ──────────────────
  // Must run before Phase 2a so a past_due+cancel_at_period_end subscription
  // whose period has ended is finalized as canceled rather than retried/charged.
  // listDuePastDueRetries also excludes these rows as a second guard, but
  // running 2b first is the primary correctness gate.
  const remaining2b = maxPerRun - result.processed;
  if (remaining2b > 0) {
    const toCancel = await listDueForCancellation(now, remaining2b);
    for (const sub of toCancel) {
      result.processed++;
      try {
        const outcome = await finalizeOneCancellation(sub);
        if (outcome === "canceled") result.canceled++;
        else result.skipped++;
      } catch (err) {
        result.errored++;
        console.error(`[RenewalCharger] Phase 2b sub ${sub.id} threw unexpectedly:`, err);
      }
    }
  }

  // ── Phase 2a: dunning retries ─────────────────────────────────────────────
  const remaining2a = maxPerRun - result.processed;
  if (remaining2a > 0) {
    const retries = await listDuePastDueRetries(now, remaining2a);
    for (const sub of retries) {
      result.processed++;
      try {
        const outcome = await chargeOneRetry(sub, now);
        if (outcome === "succeeded") result.succeeded++;
        else if (outcome === "declined_advance") result.declined++;
        else if (outcome === "declined_final") {
          result.declined++;
          result.revoked++;
        } else {
          result.skipped++;
        }
      } catch (err) {
        result.errored++;
        console.error(`[RenewalCharger] Phase 2a sub ${sub.id} threw unexpectedly:`, err);
      }
    }
  }

  return result;
}

// ── Hourly BullMQ scheduler (thin wrapper) ─────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = "subscription-renewals";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;

function getConnection(): ConnectionOptions {
  if (!connection) {
    connection = new IORedis(REDIS_URL, { ...QUEUE_REDIS_OPTIONS });
    connection.on("error", makeThrottledRedisErrorLogger("[RenewalCharger]"));
  }
  return connection as unknown as ConnectionOptions;
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return queue;
}

export async function startRenewalCharger(): Promise<void> {
  const q = getQueue();

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      console.log(`[RenewalCharger] Processing job: ${job.name}`);
      try {
        return await processDueRenewals();
      } finally {
        // Stamp the heartbeat on EVERY invocation — even one that threw — so the
        // dead-man's-switch reflects that the scheduler actually fired. A
        // wholesale failure still surfaces via the worker "failed" alert below.
        await recordChargerRun().catch(() => {});
      }
    },
    {
      connection: getConnection(),
      concurrency: 1,
    },
  );

  worker.on("failed", (job, err) => {
    const message = err?.message ?? String(err);
    console.error(`[RenewalCharger] Job ${job?.name} failed:`, message);
    // Escalate to on-call. Fire-and-forget; the dispatcher throttles repeats
    // (single dedup key) so a persistently-failing charger pages once per window
    // rather than on every hourly tick.
    queueBillingAlert({
      type: "renewal_charger_failed",
      jobName: job?.name ?? QUEUE_NAME,
      error: message,
    });
  });

  // Clear any previously-registered repeatable jobs so a changed schedule never
  // leaves a stale duplicate behind.
  const existingJobs = await q.getRepeatableJobs();
  for (const job of existingJobs) {
    await q.removeRepeatableByKey(job.key);
  }

  await q.add(
    "processDueRenewals",
    {},
    { repeat: { pattern: "0 * * * *" } }, // top of every hour
  );

  console.log("[RenewalCharger] Worker started, hourly renewal + dunning job scheduled");
}

export async function shutdownRenewalCharger(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    connection.disconnect();
    connection = null;
  }
  console.log("[RenewalCharger] Shutdown complete");
}
