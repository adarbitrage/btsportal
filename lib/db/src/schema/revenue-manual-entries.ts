import { pgTable, text, serial, integer, numeric, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const revenueManualEntriesTable = pgTable("revenue_manual_entries", {
  id: serial("id").primaryKey(),
  metric: text("metric").notNull(),
  period: text("period").notNull(),
  value: numeric("value", { precision: 18, scale: 4 }).notNull(),
  source: text("source"),
  notes: text("notes"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("idx_manual_entries_unique").on(table.metric, table.period),
]);

export const insertRevenueManualEntrySchema = createInsertSchema(revenueManualEntriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRevenueManualEntry = z.infer<typeof insertRevenueManualEntrySchema>;
export type RevenueManualEntry = typeof revenueManualEntriesTable.$inferSelect;
