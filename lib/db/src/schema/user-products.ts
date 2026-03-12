import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
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
  graceExpiresAt: timestamp("grace_expires_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserProductSchema = createInsertSchema(userProductsTable).omit({ id: true, createdAt: true });
export type InsertUserProduct = z.infer<typeof insertUserProductSchema>;
export type UserProduct = typeof userProductsTable.$inferSelect;
