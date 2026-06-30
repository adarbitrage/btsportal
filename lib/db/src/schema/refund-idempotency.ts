import { pgTable, text, serial, integer, jsonb, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { btsOrdersTable } from "./bts-orders";

export const refundIdempotencyTable = pgTable(
  "refund_idempotency",
  {
    id: serial("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    orderNumber: text("order_number").notNull(),
    amountCents: integer("amount_cents"),
    status: text("status").notNull(),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    statusCheck: check(
      "refund_idempotency_status_check",
      sql`${table.status} IN ('in_progress', 'completed')`,
    ),
  }),
);

export type RefundIdempotency = typeof refundIdempotencyTable.$inferSelect;
