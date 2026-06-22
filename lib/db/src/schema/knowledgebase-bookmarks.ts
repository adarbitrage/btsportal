import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { knowledgebaseDocsTable } from "./knowledgebase-docs";

export const knowledgebaseBookmarksTable = pgTable("knowledgebase_bookmarks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  docId: integer("doc_id").notNull().references(() => knowledgebaseDocsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("knowledgebase_bookmarks_user_doc").on(table.userId, table.docId),
]);

export const insertKnowledgebaseBookmarkSchema = createInsertSchema(knowledgebaseBookmarksTable).omit({ id: true, createdAt: true });
export type InsertKnowledgebaseBookmark = z.infer<typeof insertKnowledgebaseBookmarkSchema>;
export type KnowledgebaseBookmark = typeof knowledgebaseBookmarksTable.$inferSelect;
