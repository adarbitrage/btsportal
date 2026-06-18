import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const commsSendLogTable = pgTable("comms_send_log", {
  id: serial("id").primaryKey(),
  sendKey: text("send_key").notNull().unique(),
  channel: text("channel").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommsSendLogSchema = createInsertSchema(commsSendLogTable).omit({ id: true });
export type InsertCommsSendLog = z.infer<typeof insertCommsSendLogSchema>;
export type CommsSendLog = typeof commsSendLogTable.$inferSelect;
