import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Tier 2 of the Guided Onboarding + Accountability Partner build (Task #1591).
// Single local store of record for BOTH kickoff calls (onboarding step 4) and
// accountability-partner calls (step 5 + ongoing). GHL is the booking engine;
// this table is what the partner dashboard (T4), mentee UI (T6), reminders
// (T8) and escalations (T9) all read — never re-derive state from GHL.
//
// `staffId` is deliberately NOT a foreign key: it is polymorphic, pointing at
// either kickoff_coaches.id or partners.id depending on `staffType`. Callers
// must resolve it against the right table themselves.
export const callBookingsTable = pgTable(
  "call_bookings",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => usersTable.id),
    // "kickoff_coach" | "partner"
    staffType: text("staff_type").notNull(),
    // Polymorphic: kickoff_coaches.id when staffType = "kickoff_coach",
    // partners.id when staffType = "partner". No FK — see note above.
    staffId: integer("staff_id").notNull(),
    // "kickoff" | "partner"
    type: text("type").notNull(),
    ghlCalendarId: text("ghl_calendar_id").notNull(),
    ghlLocationId: text("ghl_location_id"),
    ghlAppointmentId: text("ghl_appointment_id").unique(),
    ghlContactId: text("ghl_contact_id"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    meetingUrl: text("meeting_url"),
    // booked | completed | no_show | canceled. Completion / no-show status
    // changes are Tier 3 (GHL webhooks) — out of scope here, but the column
    // exists now so Tier 3 never needs a schema change.
    status: text("status").notNull().default("booked"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_call_bookings_member").on(table.memberId),
    // Backs both the per-partner 5/day cap count and per-staff-per-day lookups
    // in general (kickoff coaches don't have a cap today, but the index still
    // serves their "mine" queries).
    index("idx_call_bookings_staff_scheduled").on(table.staffId, table.scheduledAt),
  ],
);

export type CallBooking = typeof callBookingsTable.$inferSelect;
export type InsertCallBooking = typeof callBookingsTable.$inferInsert;
