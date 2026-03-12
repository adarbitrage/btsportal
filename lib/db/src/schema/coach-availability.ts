import { pgTable, text, serial, integer, time, index } from "drizzle-orm/pg-core";
import { coachesTable } from "./coaches";

export const coachAvailabilityTable = pgTable("coach_availability", {
  id: serial("id").primaryKey(),
  coachId: integer("coach_id").notNull().references(() => coachesTable.id),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  timezone: text("timezone").notNull().default("America/New_York"),
}, (table) => [
  index("idx_coach_availability_coach").on(table.coachId),
]);

export type CoachAvailability = typeof coachAvailabilityTable.$inferSelect;
