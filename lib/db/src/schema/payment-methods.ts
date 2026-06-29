import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const paymentMethodsTable = pgTable(
  "payment_methods",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    vaultId: text("vault_id").notNull(),
    last4: text("last4").notNull(),
    brand: text("brand").notNull(),
    expMonth: integer("exp_month").notNull(),
    expYear: integer("exp_year").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index("payment_methods_user_id_idx").on(table.userId),
  }),
);

export type PaymentMethod = typeof paymentMethodsTable.$inferSelect;
export type InsertPaymentMethod = typeof paymentMethodsTable.$inferInsert;
