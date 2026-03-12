import { pgTable, text, serial, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ghlConfigTable = pgTable("ghl_config", {
  id: serial("id").primaryKey(),
  configKey: text("config_key").notNull().unique(),
  configValue: text("config_value").notNull(),
  jsonValue: jsonb("json_value"),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertGhlConfigSchema = createInsertSchema(ghlConfigTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGhlConfig = z.infer<typeof insertGhlConfigSchema>;
export type GhlConfig = typeof ghlConfigTable.$inferSelect;
