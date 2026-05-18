import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const webhookLogsTable = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull().default("received"),
  payload: jsonb("payload").notNull(),
  result: jsonb("result"),
  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWebhookLogSchema = createInsertSchema(webhookLogsTable).omit({ id: true, createdAt: true });
export type InsertWebhookLog = z.infer<typeof insertWebhookLogSchema>;
export type WebhookLog = typeof webhookLogsTable.$inferSelect;
