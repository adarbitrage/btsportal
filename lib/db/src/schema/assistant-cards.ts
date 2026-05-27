import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";

export const assistantCardGroupsTable = pgTable("assistant_card_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("assistant_card_groups_sort_idx").on(table.sortOrder),
  index("assistant_card_groups_active_idx").on(table.isActive),
]);

export const assistantCardsTable = pgTable("assistant_cards", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => assistantCardGroupsTable.id),
  title: text("title").notNull(),
  description: text("description"),
  icon: text("icon"),
  entitlementKey: text("entitlement_key"),
  upgradeProductId: integer("upgrade_product_id").references(() => productsTable.id),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("assistant_cards_group_idx").on(table.groupId),
  index("assistant_cards_sort_idx").on(table.sortOrder),
  index("assistant_cards_active_idx").on(table.isActive),
]);

export const assistantCardQuestionsTable = pgTable("assistant_card_questions", {
  id: serial("id").primaryKey(),
  cardId: integer("card_id").notNull().references(() => assistantCardsTable.id),
  body: text("body").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("assistant_card_questions_card_idx").on(table.cardId),
  index("assistant_card_questions_sort_idx").on(table.sortOrder),
  index("assistant_card_questions_active_idx").on(table.isActive),
]);

export const insertAssistantCardGroupSchema = createInsertSchema(assistantCardGroupsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAssistantCardGroup = z.infer<typeof insertAssistantCardGroupSchema>;
export type AssistantCardGroup = typeof assistantCardGroupsTable.$inferSelect;

export const insertAssistantCardSchema = createInsertSchema(assistantCardsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAssistantCard = z.infer<typeof insertAssistantCardSchema>;
export type AssistantCard = typeof assistantCardsTable.$inferSelect;

export const insertAssistantCardQuestionSchema = createInsertSchema(assistantCardQuestionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAssistantCardQuestion = z.infer<typeof insertAssistantCardQuestionSchema>;
export type AssistantCardQuestion = typeof assistantCardQuestionsTable.$inferSelect;
