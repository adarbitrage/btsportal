import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

// Append-only ledger for ad-spend wallet funding and draw-down.
// Balance = SUM(amount_cents) per user.
//   type  ∈ { funding, spend }
//   source = e.g. 'nmi' (funding rows), 'campaign' (spend rows)
// Positive amount_cents = credit (funding); negative = debit (spend).
// nmi_transaction_id is populated on funding rows and is the idempotency key —
// the unique partial index on non-null values makes duplicate credits impossible.
export const adSpendTransactionsTable = pgTable(
  "ad_spend_transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    amountCents: integer("amount_cents").notNull(),
    type: text("type").notNull(),
    source: text("source").notNull(),
    nmiTransactionId: text("nmi_transaction_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_ad_spend_transactions_user").on(table.userId),
    // At most one credit row per NMI transaction — null-tolerant so spend
    // rows (which have no transaction id) can coexist freely.
    uniqueIndex("uq_ad_spend_nmi_tx_id")
      .on(table.nmiTransactionId)
      .where(sql`nmi_transaction_id IS NOT NULL`),
  ],
);

export type AdSpendTransaction = typeof adSpendTransactionsTable.$inferSelect;
