import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { productsTable } from "./products";

export const userProductsTable = pgTable("user_products", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  status: text("status").notNull().default("active"),
  thrivecartOrderId: text("thrivecart_order_id"),
  thrivecartSubId: text("thrivecart_sub_id"),
  externalOrderId: text("external_order_id"),
  externalSource: text("external_source"),
  graceExpiresAt: timestamp("grace_expires_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  externalSourceOrderIdx: index("user_products_external_source_order_idx").on(table.externalSource, table.externalOrderId),
  // Partial unique index: a user may hold at most one ACTIVE grant per product.
  // Terminal rows (expired / revoked / superseded) are excluded from the
  // predicate so they don't collide — this lets dedupe collapse duplicate
  // active grants to a single active row and keep the rest as history. Guards
  // against the double-insert race that produced duplicate active rows before
  // this index existed. Mirrors the raw-SQL index created in
  // 0061_user_products_active_unique_index.sql; declared here so
  // `drizzle-kit push` produces the same constraint set.
  activeUserProductUidx: uniqueIndex("user_products_user_product_active_uidx")
    .on(table.userId, table.productId)
    .where(sql`"status" = 'active'`),
}));

export const insertUserProductSchema = createInsertSchema(userProductsTable).omit({ id: true, createdAt: true });
export type InsertUserProduct = z.infer<typeof insertUserProductSchema>;
export type UserProduct = typeof userProductsTable.$inferSelect;
