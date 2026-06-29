import { pgTable, text, serial, integer, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { productsTable } from "./products";

export const btsOrdersTable = pgTable(
  "bts_orders",
  {
    id: serial("id").primaryKey(),
    orderNumber: text("order_number").notNull().unique(),
    userId: integer("user_id").references(() => usersTable.id),
    email: text("email").notNull(),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("pending"),
    gatewayTransactionId: text("gateway_transaction_id"),
    orderType: text("order_type").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index("bts_orders_user_id_idx").on(table.userId),
    emailIdx: index("bts_orders_email_idx").on(table.email),
    statusIdx: index("bts_orders_status_idx").on(table.status),
    statusCheck: check(
      "bts_orders_status_check",
      sql`${table.status} IN ('pending', 'paid', 'failed', 'refunded', 'partial_refunded')`,
    ),
    orderTypeCheck: check(
      "bts_orders_order_type_check",
      sql`${table.orderType} IN ('one_time', 'recurring_initial', 'recurring_renewal', 'wallet_topup')`,
    ),
  }),
);

export const btsOrderItemsTable = pgTable(
  "bts_order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => btsOrdersTable.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => productsTable.id),
    description: text("description"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull().default(1),
    entitlementKeysSnapshot: jsonb("entitlement_keys_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orderIdIdx: index("bts_order_items_order_id_idx").on(table.orderId),
  }),
);

export const insertBtsOrderSchema = createInsertSchema(btsOrdersTable)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    status: z.enum(["pending", "paid", "failed", "refunded", "partial_refunded"]).default("pending"),
    orderType: z.enum(["one_time", "recurring_initial", "recurring_renewal", "wallet_topup"]),
    currency: z.string().default("USD"),
  });

export const insertBtsOrderItemSchema = createInsertSchema(btsOrderItemsTable)
  .omit({ id: true, createdAt: true })
  .extend({
    quantity: z.number().int().positive().default(1),
  });

export type BtsOrder = typeof btsOrdersTable.$inferSelect;
export type InsertBtsOrder = z.infer<typeof insertBtsOrderSchema>;
export type BtsOrderItem = typeof btsOrderItemsTable.$inferSelect;
export type InsertBtsOrderItem = z.infer<typeof insertBtsOrderItemSchema>;
