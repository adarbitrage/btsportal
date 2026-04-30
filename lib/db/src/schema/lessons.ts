import { pgTable, text, serial, integer, jsonb, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { modulesTable } from "./modules";

export const lessonsTable = pgTable("lessons", {
  id: serial("id").primaryKey(),
  moduleId: integer("module_id").notNull().references(() => modulesTable.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  videoUrl: text("video_url"),
  contentType: text("content_type").notNull().default("video"),
  textContent: jsonb("text_content"),
  actionItems: jsonb("action_items").$type<LessonActionItem[]>(),
  durationMinutes: integer("duration_minutes").notNull().default(10),
  requiredEntitlement: text("required_entitlement").notNull().default("content:frontend"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("draft"),
}, (table) => [
  // Pin the storage shape of `action_items` to a JSONB array (or NULL — a
  // lesson is allowed to have no items at all). A JSONB string scalar (the
  // bug shape from #329) would silently break any raw JSONB array operator
  // (`@>`, `?`, `jsonb_array_elements`) and any future migration off
  // Drizzle's silent string-to-array reader, surfacing as a blank checklist
  // on the lesson page. Reject the bad shape at the database layer.
  // Mirrors the guard added in 0028 for `coaching_sessions.action_items`.
  check(
    "lessons_action_items_is_array",
    sql`${table.actionItems} IS NULL OR jsonb_typeof(${table.actionItems}) = 'array'`,
  ),
]);

// Per-lesson checklist item rendered by `LessonView` and edited by
// `ActionItemsEditor` in the admin lesson editor. The element typing is the
// API-layer contract; the database layer only enforces the array shape (see
// the `lessons_action_items_is_array` CHECK above).
export interface LessonActionItem {
  id: string;
  text: string;
  sortOrder: number;
}

export const insertLessonSchema = createInsertSchema(lessonsTable).omit({ id: true });
export type InsertLesson = z.infer<typeof insertLessonSchema>;
export type Lesson = typeof lessonsTable.$inferSelect;
