import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { sessionPackBookingsTable } from "./session-pack-bookings";

// Append-only ledger for purchasable 1-on-1 session credits. A member's
// balance is SUM(delta). The purchase/checkout flow (deferred) just appends a
// positive entry; until then admins grant credits. Booking = -1, early cancel
// refund = +1.
//   reason ∈ { admin_grant, booking, cancel_refund, purchase, adjustment }
export const coachingCreditLedgerTable = pgTable(
  "coaching_credit_ledger",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => usersTable.id),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    bookingId: integer("booking_id").references(() => sessionPackBookingsTable.id),
    note: text("note"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_coaching_credit_ledger_member").on(table.memberId),
    // At most one refund credit per booking — defense in depth against a
    // double-refund race when a member cancels the same session twice.
    uniqueIndex("uq_coaching_credit_ledger_cancel_refund")
      .on(table.bookingId)
      .where(sql`reason = 'cancel_refund'`),
  ],
);

export type CoachingCreditLedgerEntry = typeof coachingCreditLedgerTable.$inferSelect;
