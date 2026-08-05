import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// FE-Intensive booking store of record — the Welcome page's native booking
// surface for front-end/funnel buyers (page key "frontend-welcome").
//
// Deliberately SEPARATE from call_bookings: that table is the onboarding
// kickoff/partner store with polymorphic NOT NULL staff columns and its own
// reminder/escalation/step-advancement consumers. FE-intensive bookings have
// no staff assignment, no onboarding step, no partner cap — a thin local
// record is all the booked-state UI and cancel/rebook flows need. GHL is the
// booking engine; this table is what the portal reads (never re-derive state
// from GHL at render time).
export const feIntensiveBookingsTable = pgTable(
  "fe_intensive_bookings",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => usersTable.id),
    ghlCalendarId: text("ghl_calendar_id").notNull(),
    ghlLocationId: text("ghl_location_id"),
    ghlAppointmentId: text("ghl_appointment_id").unique(),
    ghlContactId: text("ghl_contact_id"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    // booked | canceled (completed/no_show can land later without a schema
    // change if GHL webhooks ever feed this table).
    status: text("status").notNull().default("booked"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [index("idx_fe_intensive_bookings_member").on(table.memberId, table.scheduledAt)],
);

export type FeIntensiveBooking = typeof feIntensiveBookingsTable.$inferSelect;
export type InsertFeIntensiveBooking = typeof feIntensiveBookingsTable.$inferInsert;
