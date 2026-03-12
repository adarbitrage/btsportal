import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const chatSystemPromptsTable = pgTable("chat_system_prompts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChatSystemPromptSchema = createInsertSchema(chatSystemPromptsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChatSystemPrompt = z.infer<typeof insertChatSystemPromptSchema>;
export type ChatSystemPrompt = typeof chatSystemPromptsTable.$inferSelect;
