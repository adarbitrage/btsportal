import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { lessonsTable } from "./lessons";

export const lessonResourcesTable = pgTable("lesson_resources", {
  id: serial("id").primaryKey(),
  lessonId: integer("lesson_id").notNull().references(() => lessonsTable.id),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  fileType: text("file_type").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  downloadCount: integer("download_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLessonResourceSchema = createInsertSchema(lessonResourcesTable).omit({ id: true, createdAt: true, downloadCount: true });
export type InsertLessonResource = z.infer<typeof insertLessonResourceSchema>;
export type LessonResource = typeof lessonResourcesTable.$inferSelect;
