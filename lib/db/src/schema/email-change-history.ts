import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const emailChangeHistoryTable = pgTable(
  "email_change_history",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    oldEmail: text("old_email").notNull(),
    newEmail: text("new_email").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    oldEmailIdx: index("email_change_history_old_email_idx").on(table.oldEmail),
    userIdIdx: index("email_change_history_user_id_idx").on(table.userId),
  }),
);

export type EmailChangeHistory = typeof emailChangeHistoryTable.$inferSelect;
export type InsertEmailChangeHistory = typeof emailChangeHistoryTable.$inferInsert;
