import { pgTable, serial, integer, date, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const voiceDailyUsageTable = pgTable("voice_daily_usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  usageDate: date("usage_date").notNull(),
  secondsUsed: integer("seconds_used").notNull().default(0),
}, (table) => [
  uniqueIndex("voice_daily_usage_user_date_idx").on(table.userId, table.usageDate),
]);

export type VoiceDailyUsage = typeof voiceDailyUsageTable.$inferSelect;
export type InsertVoiceDailyUsage = typeof voiceDailyUsageTable.$inferInsert;
