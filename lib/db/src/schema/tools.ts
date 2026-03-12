import { pgTable, text, serial, integer, boolean, timestamp, jsonb, date, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const toolCategoriesTable = pgTable("tool_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ToolCategory = typeof toolCategoriesTable.$inferSelect;
export const insertToolCategorySchema = createInsertSchema(toolCategoriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertToolCategory = z.infer<typeof insertToolCategorySchema>;

export const toolsTable = pgTable("tools", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  shortDescription: text("short_description").notNull(),
  longDescription: text("long_description"),
  categoryId: integer("category_id").notNull().references(() => toolCategoriesTable.id),
  type: text("type").notNull().default("builtin"),
  requiredEntitlement: text("required_entitlement").notNull().default("software:base"),
  config: jsonb("config").notNull().default({}),
  icon: text("icon"),
  status: text("status").notNull().default("active"),
  isFeatured: integer("is_featured").notNull().default(0),
  isNew: boolean("is_new").notNull().default(false),
  isBeta: boolean("is_beta").notNull().default(false),
  badge: text("badge"),
  totalLaunches: integer("total_launches").notNull().default(0),
  helpDocUrl: text("help_doc_url"),
  videoTutorialUrl: text("video_tutorial_url"),
  rateLimitPerDay: integer("rate_limit_per_day"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("tools_category_idx").on(table.categoryId),
  index("tools_status_idx").on(table.status),
  index("tools_sort_idx").on(table.sortOrder),
]);

export const toolUserDataTable = pgTable("tool_user_data", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  toolId: integer("tool_id").notNull().references(() => toolsTable.id),
  dataKey: text("data_key").notNull(),
  dataValue: jsonb("data_value").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("tool_user_data_unique").on(table.userId, table.toolId, table.dataKey),
]);

export const toolUsageLogTable = pgTable("tool_usage_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  toolId: integer("tool_id").notNull().references(() => toolsTable.id),
  action: text("action").notNull(),
  entitlementTier: text("entitlement_tier"),
  aiTokensUsed: integer("ai_tokens_used"),
  aiCostCents: integer("ai_cost_cents"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("tool_usage_log_tool_idx").on(table.toolId),
  index("tool_usage_log_user_idx").on(table.userId),
  index("tool_usage_log_created_idx").on(table.createdAt),
  index("tool_usage_log_action_idx").on(table.action),
]);

export const toolDailyUsageTable = pgTable("tool_daily_usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  toolId: integer("tool_id").notNull().references(() => toolsTable.id),
  usageDate: date("usage_date").notNull(),
  generationCount: integer("generation_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tool_daily_usage_unique").on(table.userId, table.toolId, table.usageDate),
]);

export const insertToolSchema = createInsertSchema(toolsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTool = z.infer<typeof insertToolSchema>;
export type Tool = typeof toolsTable.$inferSelect;

export const insertToolUserDataSchema = createInsertSchema(toolUserDataTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertToolUserData = z.infer<typeof insertToolUserDataSchema>;
export type ToolUserData = typeof toolUserDataTable.$inferSelect;

export const insertToolUsageLogSchema = createInsertSchema(toolUsageLogTable).omit({ id: true, createdAt: true });
export type InsertToolUsageLog = z.infer<typeof insertToolUsageLogSchema>;
export type ToolUsageLog = typeof toolUsageLogTable.$inferSelect;

export const insertToolDailyUsageSchema = createInsertSchema(toolDailyUsageTable).omit({ id: true, createdAt: true });
export type InsertToolDailyUsage = z.infer<typeof insertToolDailyUsageSchema>;
export type ToolDailyUsage = typeof toolDailyUsageTable.$inferSelect;
