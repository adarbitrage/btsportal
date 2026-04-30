import { pgTable, text, serial, timestamp, jsonb, boolean, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const webhookSubscriptionsTable = pgTable(
  "webhook_subscriptions",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    targetUrl: text("target_url").notNull(),
    secret: text("secret").notNull(),
    eventTypes: jsonb("event_types").notNull().$type<string[]>(),
    active: boolean("active").notNull().default(true),
    consecutiveFailureDays: integer("consecutive_failure_days").notNull().default(0),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: text("disabled_reason"),
    createdById: integer("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Pin the storage shape of `event_types` to a JSONB array. The webhook
    // dispatcher matches outgoing events against this list with `@>` / `?`
    // to decide which subscriptions get notified — a JSONB string scalar
    // (the bug shape from #329) would silently match nothing and the
    // subscription would stop receiving events with no error surface.
    // Reject the bad shape at the database layer. Mirrors the guard added
    // in 0022 for `products.entitlement_keys`.
    eventTypesIsArray: check(
      "webhook_subscriptions_event_types_is_array",
      sql`jsonb_typeof(${table.eventTypes}) = 'array'`,
    ),
  }),
);

export const insertWebhookSubscriptionSchema = createInsertSchema(webhookSubscriptionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  consecutiveFailureDays: true,
  lastFailureAt: true,
  lastSuccessAt: true,
  disabledAt: true,
  disabledReason: true,
});
export type InsertWebhookSubscription = z.infer<typeof insertWebhookSubscriptionSchema>;
export type WebhookSubscription = typeof webhookSubscriptionsTable.$inferSelect;
