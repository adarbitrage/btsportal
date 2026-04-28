import { pgTable, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const emailChangeAttemptsTable = pgTable(
  "email_change_attempts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index("email_change_attempts_user_created_idx").on(
      t.userId,
      t.createdAt,
    ),
  }),
);

export type EmailChangeAttempt = typeof emailChangeAttemptsTable.$inferSelect;
