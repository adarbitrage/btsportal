import { pgTable, text, serial, integer, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
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

/**
 * Rolling per-session "Conversation Continuity Summary" (Task #1989). One row
 * per session, created only once a conversation outgrows the chat history
 * window. `coveredThroughMessageId` is the watermark: the highest chat_messages
 * id whose content is folded into `summary`. The chat route only injects a
 * summary whose watermark exactly matches the newest message that aged out of
 * the window — a stale watermark means the summary is silently skipped
 * (fail-open), never reused.
 *
 * Within-conversation only by design: no cross-session or cross-member memory.
 * Companion migration: lib/db/drizzle/0123_chat_session_summaries.sql (wired
 * into scripts/post-merge.sh); the chat path fails open if the table is absent.
 */
export const chatSessionSummariesTable = pgTable(
  "chat_session_summaries",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => chatSessionsTable.id),
    summary: text("summary").notNull(),
    coveredThroughMessageId: integer("covered_through_message_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("chat_session_summaries_session_id_unique").on(table.sessionId)],
);

export type ChatSessionSummary = typeof chatSessionSummariesTable.$inferSelect;
