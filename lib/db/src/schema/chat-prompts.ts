import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const chatPromptsTable = pgTable("chat_prompts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChatPromptSchema = createInsertSchema(chatPromptsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChatPrompt = z.infer<typeof insertChatPromptSchema>;
export type ChatPrompt = typeof chatPromptsTable.$inferSelect;
