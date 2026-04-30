import { pgTable, text, serial, integer, jsonb, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { lessonsTable, type LessonActionItem } from "./lessons";

export const lessonVersionsTable = pgTable("lesson_versions", {
  id: serial("id").primaryKey(),
  lessonId: integer("lesson_id").notNull().references(() => lessonsTable.id),
  versionNumber: integer("version_number").notNull(),
  title: text("title").notNull(),
  contentType: text("content_type").notNull(),
  videoUrl: text("video_url"),
  textContent: jsonb("text_content"),
  actionItems: jsonb("action_items").$type<LessonActionItem[]>(),
  publishedBy: integer("published_by"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  changeSummary: text("change_summary"),
}, (table) => [
  // Snapshot of `lessons.action_items` taken whenever a lesson version is
  // saved. Same shape contract, same database-layer guard — mirrors the
  // CHECK on `lessons.action_items` so a bad-shape write to either table
  // is caught at the storage boundary.
  check(
    "lesson_versions_action_items_is_array",
    sql`${table.actionItems} IS NULL OR jsonb_typeof(${table.actionItems}) = 'array'`,
  ),
]);

export const insertLessonVersionSchema = createInsertSchema(lessonVersionsTable).omit({ id: true });
export type InsertLessonVersion = z.infer<typeof insertLessonVersionSchema>;
export type LessonVersion = typeof lessonVersionsTable.$inferSelect;
