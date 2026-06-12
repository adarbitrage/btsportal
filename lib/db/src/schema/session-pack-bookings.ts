import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { sessionPackCoachesTable } from "./session-pack-coaches";

// A booked 1-on-1 session against a coach's GHL calendar. The GHL appointment
// is the system of record on the calendar side; this row links it to the BTS
// member and is the source for "upcoming/past sessions" + the credit ledger.
export const sessionPackBookingsTable = pgTable(
  "session_pack_bookings",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => usersTable.id),
    coachId: integer("coach_id")
      .notNull()
      .references(() => sessionPackCoachesTable.id),
    ghlCalendarId: text("ghl_calendar_id").notNull(),
    ghlAppointmentId: text("ghl_appointment_id").unique(),
    ghlContactId: text("ghl_contact_id"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    meetLink: text("meet_link"),
    // booked | cancelled | completed | no_show
    status: text("status").notNull().default("booked"),
    title: text("title"),
    // Admin-authored notes about the session outcome (lifecycle management).
    coachNotes: text("coach_notes"),
    // When an admin finalized the outcome (status -> completed | no_show).
    outcomeAt: timestamp("outcome_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_session_pack_booking_member").on(table.memberId),
    index("idx_session_pack_booking_scheduled").on(table.scheduledAt),
  ],
);

export type SessionPackBooking = typeof sessionPackBookingsTable.$inferSelect;
