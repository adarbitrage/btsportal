import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const emailChangeAttemptsTable = pgTable(
  "email_change_attempts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // The new email address the member tried to switch to. Nullable for legacy
    // rows inserted before this column existed; new attempts always populate it
    // so admins can see what the member was trying to change to.
    newEmail: text("new_email"),
    // When the verification link for this attempt would expire. Used together
    // with the existence of a confirmed row in `email_change_history` to
    // classify each attempt as pending / confirmed / expired / abandoned.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // When an admin cancelled this still-pending attempt via the admin
    // member-detail page. Both columns are populated together by the
    // /admin/members/:id/cancel-email-change handler so support staff
    // reviewing a member's history later can tell that the row was killed
    // intentionally by an admin (vs. expired or abandoned by the member),
    // who did it, and when.
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledByAdminId: integer("cancelled_by_admin_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
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
