import { pgTable, text, serial, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { coachesTable } from "./coaches";

// Per-(coach, callType) booking calendar config. A single coach can offer more
// than one bookable kind of call (e.g. a VA running both 1-on-1 VA calls and,
// later, onboarding), each with its own GoHighLevel booking calendar — which a
// handful of columns on the coach row can't model. This table is the single
// source of truth for those calendars.
//
// `callType` is intentionally free text (not a PG enum) so new call types can be
// added without a schema migration. The ones with real behaviour today are
// "private_coaching" (the strategic-coach credit-pack flow, migrated off the
// deprecated coaches.ghl* columns) and "one_on_one_va" (free 1-on-1 VA calls).
export const coachCallCalendarsTable = pgTable(
  "coach_call_calendars",
  {
    id: serial("id").primaryKey(),
    coachId: integer("coach_id")
      .notNull()
      .references(() => coachesTable.id, { onDelete: "cascade" }),
    // Which kind of call this calendar is for, e.g. "private_coaching" or
    // "one_on_one_va". One row per (coachId, callType).
    callType: text("call_type").notNull(),
    // GoHighLevel booking calendar + location the appointment is created on.
    // Nullable so a row can exist (capability toggled on) before the calendar is
    // wired; the booking flow treats a null bookingCalendarId as "not bookable".
    bookingCalendarId: text("booking_calendar_id"),
    bookingLocationId: text("booking_location_id"),
    // Cross-company conflict calendar (mirrors the coach-row conflict pair): read
    // for free/busy and mirrored a busy block on every booking. Null = dormant.
    conflictCalendarId: text("conflict_calendar_id"),
    conflictLocationId: text("conflict_location_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // One calendar config per (coach, callType).
    coachCallTypeUnq: unique("coach_call_calendars_coach_call_type_unq").on(t.coachId, t.callType),
    // A GHL booking calendar belongs to exactly one (coach, callType). PG treats
    // NULLs as distinct, so unconfigured rows don't collide.
    bookingCalendarUnq: unique("coach_call_calendars_booking_calendar_unq").on(t.bookingCalendarId),
  }),
);

export const insertCoachCallCalendarSchema = createInsertSchema(coachCallCalendarsTable).omit({
  id: true,
});
export type InsertCoachCallCalendar = z.infer<typeof insertCoachCallCalendarSchema>;
export type CoachCallCalendar = typeof coachCallCalendarsTable.$inferSelect;
