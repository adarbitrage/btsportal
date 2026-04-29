import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const phoneChangeHistoryTable = pgTable(
  "phone_change_history",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    oldPhone: text("old_phone").notNull(),
    newPhone: text("new_phone"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    oldPhoneIdx: index("phone_change_history_old_phone_idx").on(table.oldPhone),
    userIdIdx: index("phone_change_history_user_id_idx").on(table.userId),
  }),
);

export type PhoneChangeHistory = typeof phoneChangeHistoryTable.$inferSelect;
export type InsertPhoneChangeHistory = typeof phoneChangeHistoryTable.$inferInsert;
