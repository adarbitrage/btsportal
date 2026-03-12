import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { affiliateProfilesTable } from "./affiliate-profiles";

export const commissionPayoutsTable = pgTable("commission_payouts", {
  id: serial("id").primaryKey(),
  affiliateId: integer("affiliate_id").notNull().references(() => affiliateProfilesTable.id),
  amount: integer("amount").notNull(),
  commissionCount: integer("commission_count").notNull().default(0),
  status: text("status").notNull().default("pending"),
  paypalEmail: text("paypal_email"),
  paypalTransactionId: text("paypal_transaction_id"),
  notes: text("notes"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_commission_payouts_affiliate").on(table.affiliateId),
  index("idx_commission_payouts_status").on(table.status),
]);

export const insertCommissionPayoutSchema = createInsertSchema(commissionPayoutsTable).omit({ id: true, createdAt: true });
export type InsertCommissionPayout = z.infer<typeof insertCommissionPayoutSchema>;
export type CommissionPayout = typeof commissionPayoutsTable.$inferSelect;
