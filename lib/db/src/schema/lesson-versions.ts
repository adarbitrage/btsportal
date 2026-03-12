import { pgTable, text, serial, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { lessonsTable } from "./lessons";

export const lessonVersionsTable = pgTable("lesson_versions", {
  id: serial("id").primaryKey(),
  lessonId: integer("lesson_id").notNull().references(() => lessonsTable.id),
  versionNumber: integer("version_number").notNull(),
  title: text("title").notNull(),
  contentType: text("content_type").notNull(),
  videoUrl: text("video_url"),
  textContent: jsonb("text_content"),
  actionItems: jsonb("action_items"),
  publishedBy: integer("published_by"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  changeSummary: text("change_summary"),
});

export const insertLessonVersionSchema = createInsertSchema(lessonVersionsTable).omit({ id: true });
export type InsertLessonVersion = z.infer<typeof insertLessonVersionSchema>;
export type LessonVersion = typeof lessonVersionsTable.$inferSelect;
