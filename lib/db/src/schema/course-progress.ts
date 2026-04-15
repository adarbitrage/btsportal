import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const courseProgressTable = pgTable("course_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  courseId: text("course_id").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("course_progress_user_course_idx").on(table.userId, table.courseId),
]);

export type CourseProgress = typeof courseProgressTable.$inferSelect;
