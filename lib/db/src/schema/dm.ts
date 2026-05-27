import { pgTable, text, serial, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const dmThreadsTable = pgTable("dm_threads", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull().references(() => usersTable.id),
  adminId: integer("admin_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("dm_threads_member_admin_unique").on(table.memberId, table.adminId),
  index("dm_threads_last_message_at_idx").on(table.lastMessageAt),
]);

export const dmMessagesTable = pgTable("dm_messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull().references(() => dmThreadsTable.id),
  senderId: integer("sender_id").notNull().references(() => usersTable.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (table) => [
  index("dm_messages_thread_id_created_at_idx").on(table.threadId, table.createdAt),
]);

export type DmThread = typeof dmThreadsTable.$inferSelect;
export type InsertDmThread = typeof dmThreadsTable.$inferInsert;
export type DmMessage = typeof dmMessagesTable.$inferSelect;
export type InsertDmMessage = typeof dmMessagesTable.$inferInsert;
