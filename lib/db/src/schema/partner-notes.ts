import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { partnersTable } from "./partners";

// Accountability-partner notes on a mentee (Task #1592). Keyed to member_id
// (not to a specific partner_assignments row) so notes survive reassignment —
// a new partner inherits the full note history for the member, same pattern
// call_bookings/partner_assignments already use for continuity.
//
// authorPartnerId records who wrote it (always a partner, never an admin —
// admins with partners:view can read every partner's notes but never author
// one under their own identity). isConcern flags the note for the "needs
// attention" surface on the roster; it never auto-escalates anything on its
// own (no async engine reads it yet).
export const partnerNotesTable = pgTable(
  "partner_notes",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id").notNull().references(() => usersTable.id),
    authorPartnerId: integer("author_partner_id").notNull().references(() => partnersTable.id),
    body: text("body").notNull(),
    isConcern: boolean("is_concern").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_partner_notes_member").on(table.memberId, table.createdAt),
  ],
);

export const insertPartnerNoteSchema = createInsertSchema(partnerNotesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPartnerNote = z.infer<typeof insertPartnerNoteSchema>;
export type PartnerNote = typeof partnerNotesTable.$inferSelect;
