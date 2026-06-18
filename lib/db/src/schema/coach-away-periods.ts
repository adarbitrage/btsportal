import { pgTable, text, serial, integer, date, timestamp, index } from "drizzle-orm/pg-core";
import { coachesTable } from "./coaches";

// Self-managed coach absences ("away" / vacation / on leave). A coach (or an
// admin acting on their behalf) marks a date range; while today falls inside an
// away period the coach is hidden from the member "Your Coaches" grid and is
// not bookable for private coaching. The period naturally expires, so the coach
// is auto-restored once today passes end_date — no background job needed.
//
// Dates are stored as plain calendar dates (no time-of-day) and interpreted in
// the coaching timezone, so an away period is inclusive of both endpoints:
// start_date 2026-07-01 / end_date 2026-07-05 means the coach is away for all
// five days.
export const coachAwayPeriodsTable = pgTable(
  "coach_away_periods",
  {
    id: serial("id").primaryKey(),
    coachId: integer("coach_id")
      .notNull()
      .references(() => coachesTable.id, { onDelete: "cascade" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    // Optional short reason shown to admins (e.g. "Vacation", "On leave").
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("idx_coach_away_periods_coach").on(table.coachId)],
);

export type CoachAwayPeriod = typeof coachAwayPeriodsTable.$inferSelect;
