import { pgTable, text, serial, integer, timestamp, index, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const dmThreadsTable = pgTable("dm_threads", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull().references(() => usersTable.id),
  adminId: integer("admin_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Mirror the UNIQUE constraint added in 0037_dm_tables.sql so `drizzle-kit
  // push` produces the same constraint set as running all migrations. A
  // `uniqueIndex` would create the index but not the named UNIQUE constraint
  // the raw migration attaches, so use `unique()` here.
  unique("dm_threads_member_admin_unique").on(table.memberId, table.adminId),
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
  // Mirror the CHECK added in 0037_dm_tables.sql so `drizzle-kit push`
  // produces the same constraint set as running all migrations. Bounds match
  // the API-layer validation in artifacts/api-server/src/routes/dm.ts.
  check(
    "dm_messages_body_length",
    sql`char_length(${table.body}) >= 1 AND char_length(${table.body}) <= 5000`,
  ),
]);

export type DmThread = typeof dmThreadsTable.$inferSelect;
export type InsertDmThread = typeof dmThreadsTable.$inferInsert;
export type DmMessage = typeof dmMessagesTable.$inferSelect;
export type InsertDmMessage = typeof dmMessagesTable.$inferInsert;
