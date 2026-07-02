/**
 * Refund/chargeback events ingested from NMI, independent of whether the
 * reversal was initiated through our ops-refund flow. This is the blind-spot
 * fix: a refund issued directly in the NMI dashboard never touches
 * `ops-refund-service.ts` (and its `refund_idempotency` table), so it needs
 * its own durable, idempotent record.
 *
 * `nmiTransactionId` is UNIQUE — this is the *entire* idempotency mechanism
 * for the daily poller (see `nmi-refund-poller.ts`). Re-polling the same NMI
 * transaction window is always safe: `onConflictDoNothing` against this
 * column silently skips rows we've already recorded.
 *
 * `memberId` / `orderId` are nullable because a transaction is only matched
 * when its `order_id` (the NMI `orderid` field we set at charge time) maps
 * to a known `bts_orders` row. Unmatched transactions are still inserted
 * (never dropped) with `matched = false` so they stay auditable; the
 * partnered-cohort metric view only ever counts matched rows.
 */
import { pgTable, text, serial, integer, boolean, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { btsOrdersTable } from "./bts-orders";

export const memberRefundEventsTable = pgTable(
  "member_refund_events",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id").references(() => usersTable.id),
    orderId: integer("order_id").references(() => btsOrdersTable.id),
    orderNumber: text("order_number"),
    type: text("type").notNull(),
    amountCents: integer("amount_cents").notNull(),
    nmiTransactionId: text("nmi_transaction_id").notNull().unique(),
    matched: boolean("matched").notNull().default(true),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    memberIdIdx: index("member_refund_events_member_id_idx").on(table.memberId),
    occurredAtIdx: index("member_refund_events_occurred_at_idx").on(table.occurredAt),
    typeCheck: check(
      "member_refund_events_type_check",
      sql`${table.type} IN ('refund', 'chargeback')`,
    ),
  }),
);

export type MemberRefundEvent = typeof memberRefundEventsTable.$inferSelect;
export type InsertMemberRefundEvent = typeof memberRefundEventsTable.$inferInsert;
