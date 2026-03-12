import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const chatRateLimitsTable = pgTable("chat_rate_limits", {
  id: serial("id").primaryKey(),
  tier: text("tier").notNull().unique(),
  dailyLimit: integer("daily_limit").notNull(),
  maxOutputTokens: integer("max_output_tokens").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChatRateLimitSchema = createInsertSchema(chatRateLimitsTable).omit({ id: true, updatedAt: true });
export type InsertChatRateLimit = z.infer<typeof insertChatRateLimitSchema>;
export type ChatRateLimit = typeof chatRateLimitsTable.$inferSelect;
