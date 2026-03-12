import { pgTable, text, serial, integer, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";

export const commissionRatesTable = pgTable("commission_rates", {
  id: serial("id").primaryKey(),
  tier: text("tier").notNull(),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  ratePercent: numeric("rate_percent", { precision: 5, scale: 2 }).notNull(),
  flatBonus: integer("flat_bonus").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("idx_commission_rates_tier_product").on(table.tier, table.productId),
]);

export const insertCommissionRateSchema = createInsertSchema(commissionRatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCommissionRate = z.infer<typeof insertCommissionRateSchema>;
export type CommissionRate = typeof commissionRatesTable.$inferSelect;
