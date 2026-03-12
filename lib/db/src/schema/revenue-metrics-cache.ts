import { pgTable, text, serial, integer, numeric, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const revenueMetricsCacheTable = pgTable("revenue_metrics_cache", {
  id: serial("id").primaryKey(),
  metricKey: text("metric_key").notNull(),
  period: text("period").notNull(),
  value: numeric("value", { precision: 18, scale: 4 }).notNull(),
  breakdown: jsonb("breakdown"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("idx_revenue_metrics_unique").on(table.metricKey, table.period),
  index("idx_revenue_metrics_computed").on(table.computedAt),
]);

export const insertRevenueMetricsCacheSchema = createInsertSchema(revenueMetricsCacheTable).omit({ id: true });
export type InsertRevenueMetricsCache = z.infer<typeof insertRevenueMetricsCacheSchema>;
export type RevenueMetricsCache = typeof revenueMetricsCacheTable.$inferSelect;
