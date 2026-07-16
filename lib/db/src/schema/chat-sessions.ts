import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const chatSessionsTable = pgTable("chat_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull().default("New Chat"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChatSessionSchema = createInsertSchema(chatSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChatSession = z.infer<typeof insertChatSessionSchema>;
export type ChatSession = typeof chatSessionsTable.$inferSelect;

/**
 * Per-message retrieval trace (Task #1925). Stored ONLY on assistant messages,
 * written at answer time from the SAME retrieval result the answer used.
 * ADMIN-ONLY data: member-facing session reads must never select this column.
 */
export interface ChatRetrievalTrace {
  version: 1;
  /** Retrieval cleared the confidence bar → docs were injected into context. */
  confident: boolean;
  /** True when docs were actually placed into the system prompt. */
  usedInContext: boolean;
  topScore: number;
  topSemanticScore: number;
  lexicalFloor: number;
  semanticFloor: number;
  docs: {
    id: number;
    title: string;
    homeRoot: string | null;
    node: string | null;
    docClass: string | null;
    rank: number;
    semanticScore: number;
    grounded: boolean;
    /** This doc individually cleared a confidence floor (else: near-miss). */
    clearedFloor: boolean;
  }[];
}

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => chatSessionsTable.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  flagged: boolean("flagged").notNull().default(false),
  adminNotes: text("admin_notes"),
  retrievalTrace: jsonb("retrieval_trace").$type<ChatRetrievalTrace>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
