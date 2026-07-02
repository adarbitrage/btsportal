/**
 * Daily NMI refund/chargeback poller.
 *
 * Why this exists: `ops-refund-service.ts` handles reversals we initiate
 * ourselves, but nothing observes refunds/chargebacks issued directly in the
 * NMI dashboard — the current blind spot for the accountability-partner
 * program's judgment metric (refund/chargeback rate). This job polls NMI's
 * transaction-listing endpoint on a watermark, matches results back to
 * members via `bts_orders`, and records everything (matched or not) in
 * `member_refund_events`.
 *
 * Hard scope fence: this module is READ-ONLY against NMI and never touches
 * charging, refund-issuing, dunning, or any billing-mutation logic. It does
 * not use webhooks — polling was a deliberate choice made in the task spec.
 *
 * Idempotency: `member_refund_events.nmi_transaction_id` is UNIQUE. Every
 * insert uses `onConflictDoNothing`, so re-polling an overlapping window
 * (which happens by design — see `POLL_OVERLAP_MS` below) never double-counts.
 *
 * Watermark: persisted in `system_settings` under `nmi_refund_poller.*` so it
 * survives restarts. Advanced to the poll window's end only after a
 * successful run, so a crash mid-run simply re-polls (safely, thanks to the
 * unique-key idempotency) rather than skipping a window.
 */

import { db, systemSettingsTable, btsOrdersTable, memberRefundEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { queryTransactionsByDateRange, type NmiTransactionRecord } from "./payments/nmi-gateway.js";

const WATERMARK_KEY = "nmi_refund_poller.last_polled_at";
const CATEGORY = "billing";

// How far back to look on the very first run (no watermark yet).
const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;

// Re-poll a small overlap into the previous window. NMI's `condition` (e.g.
// settlement -> refunded) can lag the original action by a bit, and a
// refund/void action can be appended to a transaction after its record was
// first visible. The unique-key idempotency makes re-seeing old rows free.
const POLL_OVERLAP_MS = 60 * 60 * 1000; // 1 hour

// Reversal action types we care about. `void` is grouped with `refund` since
// it's functionally a refund that happened before settlement (see
// `ops-refund-service.ts`'s own void-vs-refund branching for precedent).
const REFUND_ACTION_TYPES = new Set(["refund", "void"]);
const CHARGEBACK_ACTION_TYPES = new Set(["chargeback"]);
// Some processors surface a chargeback only via the transaction's overall
// `condition` rather than a discrete `action`. Checked as a fallback.
const CHARGEBACK_CONDITIONS = new Set(["chargeback"]);

export interface ClassifiedEvent {
  transactionId: string;
  orderNumber: string | undefined;
  type: "refund" | "chargeback";
  amountCents: number;
  occurredAt: Date;
}

/**
 * Reduce a raw NMI transaction record to at most one classified event.
 * A transaction can carry multiple actions (e.g. partial refund + full
 * refund); this takes the most severe/most recent reversal action so a
 * single transaction never produces more than one `member_refund_events`
 * row (the unique key is on `nmi_transaction_id`, not per-action).
 */
export function classifyTransaction(txn: NmiTransactionRecord): ClassifiedEvent | null {
  const reversalActions = txn.actions.filter(
    (a) => a.success && (REFUND_ACTION_TYPES.has(a.actionType) || CHARGEBACK_ACTION_TYPES.has(a.actionType)),
  );

  let type: "refund" | "chargeback" | null = null;
  let amountCents: number | undefined;
  let occurredAtRaw: string | undefined;

  if (reversalActions.length > 0) {
    // Chargebacks take precedence if both are present on the same transaction.
    const chargebackAction = reversalActions.find((a) => CHARGEBACK_ACTION_TYPES.has(a.actionType));
    const chosen = chargebackAction ?? reversalActions[reversalActions.length - 1];
    type = chargebackAction ? "chargeback" : "refund";
    amountCents = chosen.amountCents;
    occurredAtRaw = chosen.date;
  } else if (txn.condition && CHARGEBACK_CONDITIONS.has(txn.condition)) {
    type = "chargeback";
  }

  if (!type) return null;

  // Condition-only chargebacks (no discrete `chargeback` action) have no
  // reversal date. Fall back to the most recent dated action on the
  // transaction (e.g. the original sale) rather than "now" at poll time —
  // using poll time would misattribute historical reversals to whatever
  // month the poller happened to run in, skewing the monthly trend.
  if (!occurredAtRaw) {
    const datedActions = txn.actions.filter((a) => !!a.date);
    occurredAtRaw = datedActions.length > 0 ? datedActions[datedActions.length - 1].date : undefined;
  }

  const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date();

  return {
    transactionId: txn.transactionId,
    orderNumber: txn.orderId,
    type,
    amountCents: amountCents ?? 0,
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
  };
}

async function getWatermark(): Promise<Date> {
  const [row] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, WATERMARK_KEY))
    .limit(1);

  if (row && typeof row.value === "object" && row.value !== null && "lastPolledAt" in (row.value as object)) {
    const raw = (row.value as { lastPolledAt?: string }).lastPolledAt;
    if (raw) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return new Date(Date.now() - INITIAL_LOOKBACK_MS);
}

async function setWatermark(endDate: Date): Promise<void> {
  const value = { lastPolledAt: endDate.toISOString() };
  const existing = await db
    .select({ id: systemSettingsTable.id })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, WATERMARK_KEY))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(systemSettingsTable)
      .set({ value })
      .where(eq(systemSettingsTable.key, WATERMARK_KEY));
  } else {
    await db.insert(systemSettingsTable).values({
      key: WATERMARK_KEY,
      value,
      category: CATEGORY,
      description: "Cursor for the daily NMI refund/chargeback poller. Do not edit manually.",
    });
  }
}

export interface PollRunResult {
  windowStart: string;
  windowEnd: string;
  transactionsSeen: number;
  eventsClassified: number;
  eventsInserted: number;
  eventsMatched: number;
  eventsUnmatched: number;
  error: string | null;
}

interface PollRunState {
  lastRanAt: Date;
  lastResult: PollRunResult | null;
  lastError: { at: Date; message: string } | null;
}

let state: PollRunState | null = null;

export function getNmiRefundPollerStatus(): {
  lastRanAt: string | null;
  lastResult: PollRunResult | null;
  lastError: { at: string; message: string } | null;
} {
  if (!state) return { lastRanAt: null, lastResult: null, lastError: null };
  return {
    lastRanAt: state.lastRanAt.toISOString(),
    lastResult: state.lastResult,
    lastError: state.lastError ? { at: state.lastError.at.toISOString(), message: state.lastError.message } : null,
  };
}

export function __resetNmiRefundPollerStateForTests(): void {
  state = null;
}

/**
 * Run one poll cycle. Exposed directly (not just via the interval driver) so
 * tests and an admin "poll now" action can invoke it synchronously.
 */
export async function pollNmiRefundEvents(): Promise<PollRunResult> {
  const watermark = await getWatermark();
  const windowStart = new Date(watermark.getTime() - POLL_OVERLAP_MS);
  const windowEnd = new Date();

  let runError: string | null = null;
  const result: PollRunResult = {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    transactionsSeen: 0,
    eventsClassified: 0,
    eventsInserted: 0,
    eventsMatched: 0,
    eventsUnmatched: 0,
    error: null,
  };

  try {
    const { transactions } = await queryTransactionsByDateRange({
      startDate: windowStart,
      endDate: windowEnd,
    });
    result.transactionsSeen = transactions.length;

    for (const txn of transactions) {
      const classified = classifyTransaction(txn);
      if (!classified) continue;
      result.eventsClassified++;

      let memberId: number | null = null;
      let orderId: number | null = null;
      let matched = false;

      if (classified.orderNumber) {
        const [order] = await db
          .select({ id: btsOrdersTable.id, userId: btsOrdersTable.userId })
          .from(btsOrdersTable)
          .where(eq(btsOrdersTable.orderNumber, classified.orderNumber))
          .limit(1);
        if (order) {
          orderId = order.id;
          memberId = order.userId;
          matched = true;
        }
      }

      if (!matched) {
        console.warn(
          `[NmiRefundPoller] Unmatched ${classified.type} transaction ${classified.transactionId} ` +
            `(order_id=${classified.orderNumber ?? "none"}) — no bts_orders match. Recording unmatched, not dropping.`,
        );
      }

      const inserted = await db
        .insert(memberRefundEventsTable)
        .values({
          memberId,
          orderId,
          orderNumber: classified.orderNumber ?? null,
          type: classified.type,
          amountCents: classified.amountCents,
          nmiTransactionId: classified.transactionId,
          matched,
          occurredAt: classified.occurredAt,
        })
        .onConflictDoNothing({ target: memberRefundEventsTable.nmiTransactionId })
        .returning({ id: memberRefundEventsTable.id });

      if (inserted.length > 0) {
        result.eventsInserted++;
        if (matched) result.eventsMatched++;
        else result.eventsUnmatched++;
      }
    }

    await setWatermark(windowEnd);
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
    result.error = runError;
    console.error("[NmiRefundPoller] Poll cycle failed:", err);
  }

  state = {
    lastRanAt: new Date(),
    lastResult: result,
    lastError: runError ? { at: new Date(), message: runError } : null,
  };

  if (runError) throw new Error(runError);
  return result;
}
