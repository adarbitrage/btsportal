import { pgTable, text, serial, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const upgradePromptEventsTable = pgTable("upgrade_prompt_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  variant: text("variant").notNull(),
  sourceTier: text("source_tier").notNull(),
  lockedFeatureKeys: jsonb("locked_feature_keys").$type<string[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_upgrade_prompt_events_user_time").on(table.userId, table.createdAt),
  index("idx_upgrade_prompt_events_variant_type_time").on(table.variant, table.eventType, table.createdAt),
]);

export const insertUpgradePromptEventSchema = createInsertSchema(upgradePromptEventsTable).omit({ id: true, createdAt: true });
export type InsertUpgradePromptEvent = z.infer<typeof insertUpgradePromptEventSchema>;
export type UpgradePromptEvent = typeof upgradePromptEventsTable.$inferSelect;
