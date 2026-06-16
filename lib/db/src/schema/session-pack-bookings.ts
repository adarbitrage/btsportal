import { pgTable, text, serial, integer, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { sessionPackCoachesTable } from "./session-pack-coaches";

// A single coach/admin-authored action item attached to a pack 1-on-1 booking.
// COACH/ADMIN-FACING ONLY — never surfaced to members. Stored as JSONB on the
// booking so the full cross-coach history for a member is a simple member-id
// join (no extra table / FK lifecycle to manage).
export interface SessionPackActionItem {
  id: string;
  text: string;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
}

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
    // COACH/ADMIN-FACING ONLY — never returned to members.
    coachNotes: text("coach_notes"),
    // Structured, coach/admin-facing action items for the session.
    // COACH/ADMIN-FACING ONLY — never returned to members.
    actionItems: jsonb("action_items")
      .$type<SessionPackActionItem[]>()
      .notNull()
      .default([]),
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
