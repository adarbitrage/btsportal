/**
 * NMI recurring renewal charger (Tier 6.2a — happy path only).
 *
 * `processDueRenewals` is a pure, directly-callable function (it takes an
 * optional `now` + `maxPerRun` and returns a per-run tally), so it can be
 * driven by a test, a one-off script, or the hourly BullMQ scheduler below.
 *
 * Per subscription it reuses the audited checkout money path (`runCheckoutCore`
 * — peek → claim → order → charge → reconciliation → complete). The renewal
 * specifics are:
 *   - a DETERMINISTIC per-period idempotency key, `sub_{id}_period_{periodEndISO}`,
 *     so a double-run (overlapping ticks, retry, manual re-invoke) charges the
 *     card at most once per period;
 *   - charging the card PINNED to the subscription (its stored vault), at the
 *     amount SNAPSHOTTED on the subscription row (never re-priced from the product);
 *   - on success: advance the period + extend access (inside `onOrderPaid`, so it
 *     only runs once per period and a failure becomes `paid_reconciliation_needed`);
 *   - on decline: mark the subscription `past_due` and STOP. No retry, dunning,
 *     or access revocation — that is Tier 6.2b.
 *
 * Each subscription is isolated in its own try/catch so one bad row never aborts
 * the batch.
 */

import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { QUEUE_REDIS_OPTIONS, makeThrottledRedisErrorLogger } from "./redis";
import { runCheckoutCore } from "./payments/checkout-core";
import { extendActiveGrantExpiry } from "./external-grant-product";
import { getPaymentMethodForUser } from "../storage/payment-methods-store";
import {
  listDueSubscriptions,
  advanceSubscriptionPeriod,
  markSubscriptionPastDue,
  type SubscriptionRow,
} from "../storage/subscriptions-store";

const DEFAULT_MAX_PER_RUN = 200;

export interface ProcessDueRenewalsResult {
  /** Subscriptions selected and attempted this run. */
  processed: number;
  /** Renewals charged (or replayed as paid) and advanced. */
  succeeded: number;
  /** Renewals declined → subscription marked past_due. */
  declined: number;
  /** Subscriptions that threw an unexpected error (isolated, batch continues). */
  errored: number;
  /** In-progress / conflict / reconciliation outcomes — left for a later run. */
  skipped: number;
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
    // Default to monthly for any non-yearly interval.
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

type RenewalOutcome = "succeeded" | "declined" | "skipped";

/**
 * Charge a single due subscription's renewal. Resolves the pinned card + the
 * subscriber email, builds the deterministic per-period key, and runs the
 * shared checkout core. Translates the core outcome into a renewal disposition
 * and applies the subscription side-effect (advance was already done in
 * onOrderPaid on success; past_due is applied here on decline).
 */
async function chargeOneRenewal(sub: SubscriptionRow, now: Date): Promise<RenewalOutcome> {
  // Resolve the pinned card (its stored vault id).
  const method = await getPaymentMethodForUser(sub.paymentMethodId, sub.userId);
  if (!method) {
    await markSubscriptionPastDue(sub.id, {
      reason: "Pinned payment method not found",
      attemptedAt: now,
    });
    console.error(
      `[RenewalCharger] Subscription ${sub.id}: pinned payment method ${sub.paymentMethodId} ` +
      `not found for user ${sub.userId} — marked past_due.`,
    );
    return "declined";
  }

  // Resolve the subscriber email (required by the charge + receipt path).
  const [user] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, sub.userId))
    .limit(1);
  if (!user) {
    await markSubscriptionPastDue(sub.id, {
      reason: "Subscriber user not found",
      attemptedAt: now,
    });
    console.error(
      `[RenewalCharger] Subscription ${sub.id}: user ${sub.userId} not found — marked past_due.`,
    );
    return "declined";
  }

  const periodEnd = sub.currentPeriodEnd;
  const newPeriodStart = periodEnd;
  const newPeriodEnd = addInterval(periodEnd, sub.interval);
  // Deterministic per-period key → a double-run charges at most once per period.
  const idempotencyKey = `sub_${sub.id}_period_${periodEnd.toISOString()}`;

  const core = await runCheckoutCore({
    userId: sub.userId,
    productId: sub.productId,
    email: user.email,
    idempotencyKey,
    amountCents: sub.amountCents, // SNAPSHOT — never re-priced from the product
    currency: sub.currency,
    orderType: "recurring_renewal",
    subscriptionId: sub.id,
    grantEntitlements: false, // renewals EXTEND the existing grant, never re-grant
    entitlementKeys: [],
    durationDays: null,
    lineItemDescription: "Subscription renewal",
    resolvedVaultId: method.vaultId,
    onOrderPaid: async () => {
      // Money has moved. Advance the period and extend access. If either throws,
      // the core converts the outcome to paid_reconciliation_needed (so we do
      // NOT mark past_due / re-charge).
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
    case "declined":
    case "replay_declined": {
      const reason = core.declineReason ?? core.message ?? "Card declined";
      await markSubscriptionPastDue(sub.id, { reason, attemptedAt: now });
      return "declined";
    }
    case "paid_reconciliation_needed":
    case "replay_reconciliation_needed":
      console.error(
        `[RenewalCharger] Subscription ${sub.id}: order ${core.orderNumber} needs manual ` +
        `reconciliation (charge moved money but post-charge update failed).`,
      );
      return "skipped";
    case "in_progress":
    case "conflict":
      // Another worker holds the key, or a hash mismatch — leave for a later run.
      return "skipped";
    default: {
      const _exhaustive: never = core;
      void _exhaustive;
      return "skipped";
    }
  }
}

/**
 * Process every subscription due for renewal at `now` (default: current time),
 * up to `maxPerRun` (default: RENEWAL_MAX_PER_RUN env or 200). Pure and
 * directly callable — no Redis/queue dependency.
 */
export async function processDueRenewals(
  opts: { now?: Date; maxPerRun?: number } = {},
): Promise<ProcessDueRenewalsResult> {
  const now = opts.now ?? new Date();
  const maxPerRun = resolveMaxPerRun(opts.maxPerRun);

  const due = await listDueSubscriptions(now, maxPerRun);

  const result: ProcessDueRenewalsResult = {
    processed: 0,
    succeeded: 0,
    declined: 0,
    errored: 0,
    skipped: 0,
  };

  for (const sub of due) {
    result.processed++;
    try {
      const outcome = await chargeOneRenewal(sub, now);
      if (outcome === "succeeded") result.succeeded++;
      else if (outcome === "declined") result.declined++;
      else result.skipped++;
    } catch (err) {
      result.errored++;
      console.error(`[RenewalCharger] Subscription ${sub.id} threw during renewal:`, err);
    }
  }

  console.log(
    `[RenewalCharger] run complete — processed=${result.processed} ` +
    `succeeded=${result.succeeded} declined=${result.declined} ` +
    `skipped=${result.skipped} errored=${result.errored}`,
  );
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
        attempts: 1, // re-running is safe (idempotent) but a missed tick self-heals next hour
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
      return processDueRenewals();
    },
    {
      connection: getConnection(),
      concurrency: 1,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[RenewalCharger] Job ${job?.name} failed:`, err.message);
  });

  // Clear any previously-registered repeatable jobs so a changed schedule never
  // leaves a stale duplicate behind (mirrors revenue-pipeline.ts).
  const existingJobs = await q.getRepeatableJobs();
  for (const job of existingJobs) {
    await q.removeRepeatableByKey(job.key);
  }

  await q.add(
    "processDueRenewals",
    {},
    { repeat: { pattern: "0 * * * *" } }, // top of every hour
  );

  console.log("[RenewalCharger] Worker started, hourly renewal job scheduled");
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
