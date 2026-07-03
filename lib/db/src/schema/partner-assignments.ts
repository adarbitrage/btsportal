import { pgTable, text, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { partnersTable } from "./partners";

// Member <-> accountability-partner assignment, with full history. A
// reassignment NEVER overwrites a row — it ends the current one (status
// "ended"/"reassigned" + endedAt/endedReason) and inserts a brand-new row.
// Notes/history for the relationship stay keyed to member_id, so a new
// partner inherits everything simply by the member_id staying the same
// across rows.
export const partnerAssignmentsTable = pgTable(
  "partner_assignments",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id").notNull().references(() => usersTable.id),
    partnerId: integer("partner_id").notNull().references(() => partnersTable.id),
    // "active" = the current, live assignment. "ended" = terminal (product
    // expired, admin ended with no replacement). "reassigned" = terminal
    // because an admin action immediately replaced it with a new active row.
    status: text("status").notNull().default("active"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    // How often this pair is expected to call (Tier 2 schema only — T4 sets
    // it, T6 displays it). Null means no cadence configured yet.
    cadencePerWeek: integer("cadence_per_week"),
    // Task #1654: which selection strategy produced this row. "soonest" =
    // earliest-bookable-slot probe succeeded and picked the winner;
    // "fallback_fewest_active" = the GHL probe timed out/errored (or every
    // candidate had zero surviving slots) and assignment fell back to the
    // pre-existing fewest-active-assignments rule. Admin `reassignMember`
    // never sets this to "soonest" — it keeps the old fewest-active mode and
    // this column simply defaults for those rows too.
    assignmentMethod: text("assignment_method").notNull().default("fallback_fewest_active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Partial unique index: at most one ACTIVE assignment per member. This is
    // what makes granting idempotent (re-grants don't duplicate) and what a
    // reassignment must respect — end the old row in the same transaction
    // that inserts the new one, or the insert 23505s.
    activeAssignmentUidx: uniqueIndex("partner_assignments_member_active_uidx")
      .on(table.memberId)
      .where(sql`"status" = 'active'`),
  }),
);

export const insertPartnerAssignmentSchema = createInsertSchema(partnerAssignmentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPartnerAssignment = z.infer<typeof insertPartnerAssignmentSchema>;
export type PartnerAssignment = typeof partnerAssignmentsTable.$inferSelect;
