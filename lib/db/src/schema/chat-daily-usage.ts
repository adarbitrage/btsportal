import { pgTable, serial, integer, text, date, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const chatDailyUsageTable = pgTable("chat_daily_usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  usageDate: date("usage_date").notNull(),
  messageCount: integer("message_count").notNull().default(0),
  chatTier: text("chat_tier").notNull().default("chat:basic"),
}, (table) => [
  uniqueIndex("chat_daily_usage_user_date_idx").on(table.userId, table.usageDate),
]);

export const insertChatDailyUsageSchema = createInsertSchema(chatDailyUsageTable).omit({ id: true });
export type InsertChatDailyUsage = z.infer<typeof insertChatDailyUsageSchema>;
export type ChatDailyUsage = typeof chatDailyUsageTable.$inferSelect;
