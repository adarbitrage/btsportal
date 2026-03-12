import { pgTable, text, serial, integer, date, time, boolean, index } from "drizzle-orm/pg-core";
import { coachesTable } from "./coaches";

export const coachAvailabilityOverridesTable = pgTable("coach_availability_overrides", {
  id: serial("id").primaryKey(),
  coachId: integer("coach_id").notNull().references(() => coachesTable.id),
  overrideDate: date("override_date").notNull(),
  overrideType: text("override_type").notNull().default("blocked"),
  startTime: time("start_time"),
  endTime: time("end_time"),
  reason: text("reason"),
}, (table) => [
  index("idx_coach_override_coach_date").on(table.coachId, table.overrideDate),
]);

export type CoachAvailabilityOverride = typeof coachAvailabilityOverridesTable.$inferSelect;
