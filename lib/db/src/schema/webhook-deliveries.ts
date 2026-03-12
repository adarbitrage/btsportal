import { pgTable, text, serial, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { webhookSubscriptionsTable } from "./webhook-subscriptions";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const webhookDeliveriesTable = pgTable("webhook_deliveries", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull().references(() => webhookSubscriptionsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  eventId: text("event_id").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  httpStatus: integer("http_status"),
  responseBody: text("response_body"),
  errorMessage: text("error_message"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWebhookDeliverySchema = createInsertSchema(webhookDeliveriesTable).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});
export type InsertWebhookDelivery = z.infer<typeof insertWebhookDeliverySchema>;
export type WebhookDelivery = typeof webhookDeliveriesTable.$inferSelect;
