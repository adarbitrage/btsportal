import { pgTable, text, serial, integer, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tiersTable = pgTable("tiers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  level: integer("level").notNull(),
  priceMonthly: numeric("price_monthly", { precision: 10, scale: 2 }).notNull(),
  features: jsonb("features").default({}),
  maxSupportTickets: integer("max_support_tickets").notNull().default(3),
  callAccessLevel: text("call_access_level").notNull().default("weekly_qa"),
});

export const insertTierSchema = createInsertSchema(tiersTable).omit({ id: true });
export type InsertTier = z.infer<typeof insertTierSchema>;
export type Tier = typeof tiersTable.$inferSelect;
