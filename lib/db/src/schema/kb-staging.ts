import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const kbStagingDocsTable = pgTable("kb_staging_docs", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("curriculum"),
  content: text("content").notNull(),
  tags: text("tags").notNull().default(""),
  sourceVideoTitle: text("source_video_title"),
  sourceVideoId: text("source_video_id"),
  status: text("status").notNull().default("pending_review"),
  adminNotes: text("admin_notes"),
  editedContent: text("edited_content"),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  mergedIntoId: integer("merged_into_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("kb_staging_status_idx").on(table.status),
  index("kb_staging_search_idx").using("gin", sql`to_tsvector('english', ${table.title} || ' ' || ${table.content})`),
]);

export type KbStagingDoc = typeof kbStagingDocsTable.$inferSelect;
export type InsertKbStagingDoc = typeof kbStagingDocsTable.$inferInsert;
