import { pgTable, serial, varchar, timestamp, index } from "drizzle-orm/pg-core";

export const passwordResetAttemptsTable = pgTable(
  "password_reset_attempts",
  {
    id: serial("id").primaryKey(),
    identifierType: varchar("identifier_type", { length: 8 }).notNull(),
    identifierHash: varchar("identifier_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    identifierCreatedIdx: index(
      "password_reset_attempts_identifier_created_idx",
    ).on(t.identifierType, t.identifierHash, t.createdAt),
  }),
);

export type PasswordResetAttempt =
  typeof passwordResetAttemptsTable.$inferSelect;
