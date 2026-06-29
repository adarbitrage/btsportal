import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";

// Dedicated home for the Blitz training curriculum lessons.
//
// These 94 lessons previously lived in `kb_staging_docs` (source='blitz'),
// sharing the AI knowledge-base review/staging table. That was an
// implementation shortcut: Blitz is finished, member-facing training content
// and has nothing to do with the AI Document Review pipeline. This table fully
// decouples them. Only the curriculum/content columns Blitz actually uses are
// carried over — none of the AI triage/taxonomy fields.
export const blitzLessonsTable = pgTable("blitz_lessons", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("curriculum"),
  content: text("content").notNull(),
  tags: text("tags").notNull().default(""),
  sourceVideoTitle: text("source_video_title"),
  sourceVideoId: text("source_video_id"),
  // Retained so a lesson can still be hidden (status='rejected'); not an AI
  // review status. Authored/active lessons default to 'published'.
  status: text("status").notNull().default("published"),
  adminNotes: text("admin_notes"),
  editedContent: text("edited_content"),
  phase: text("phase"),
  module: text("module"),
  lessonId: text("lesson_id"),
  lessonType: text("lesson_type"),
  networkPath: text("network_path"),
  publisherPath: text("publisher_path"),
  blitzOrder: integer("blitz_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("blitz_lessons_order_idx").on(table.blitzOrder),
  index("blitz_lessons_lesson_id_idx").on(table.lessonId),
  index("blitz_lessons_status_idx").on(table.status),
]);

export type BlitzLessonRecord = typeof blitzLessonsTable.$inferSelect;
export type InsertBlitzLessonRecord = typeof blitzLessonsTable.$inferInsert;
