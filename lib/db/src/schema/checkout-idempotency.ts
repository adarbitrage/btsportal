import { pgTable, text, serial, integer, jsonb, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { productsTable } from "./products";
import { btsOrdersTable } from "./bts-orders";

export const checkoutIdempotencyTable = pgTable(
  "checkout_idempotency",
  {
    id: serial("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    userId: integer("user_id").notNull().references(() => usersTable.id),
    productId: integer("product_id").notNull().references(() => productsTable.id),
    status: text("status").notNull(),
    orderId: integer("order_id").references(() => btsOrdersTable.id),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    statusCheck: check(
      "checkout_idempotency_status_check",
      sql`${table.status} IN ('in_progress', 'completed')`,
    ),
  }),
);

export type CheckoutIdempotency = typeof checkoutIdempotencyTable.$inferSelect;
