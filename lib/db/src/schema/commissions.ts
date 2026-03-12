import { pgTable, text, serial, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { affiliateProfilesTable } from "./affiliate-profiles";
import { productsTable } from "./products";

export const commissionsTable = pgTable("commissions", {
  id: serial("id").primaryKey(),
  affiliateId: integer("affiliate_id").notNull().references(() => affiliateProfilesTable.id),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  orderId: text("order_id").notNull(),
  customerEmail: text("customer_email").notNull(),
  saleAmount: integer("sale_amount").notNull(),
  commissionRate: numeric("commission_rate", { precision: 5, scale: 2 }).notNull(),
  commissionAmount: integer("commission_amount").notNull(),
  flatBonus: integer("flat_bonus").notNull().default(0),
  status: text("status").notNull().default("pending"),
  tier: text("tier").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  reversalReason: text("reversal_reason"),
  payoutId: integer("payout_id"),
  fraudFlag: text("fraud_flag"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("idx_commissions_affiliate").on(table.affiliateId),
  index("idx_commissions_status").on(table.status),
  index("idx_commissions_order").on(table.orderId),
  index("idx_commissions_created").on(table.createdAt),
]);

export const insertCommissionSchema = createInsertSchema(commissionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCommission = z.infer<typeof insertCommissionSchema>;
export type Commission = typeof commissionsTable.$inferSelect;
