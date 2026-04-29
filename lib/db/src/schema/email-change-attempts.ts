import { pgTable, serial, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
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
    // member-detail page, OR when the member themselves cancelled / replaced
    // the pending change from the portal. Set together with one of
    // `cancelledByAdminId` (admin path) or `cancelledByMember = true`
    // (member path) so the attempts card on the admin Member Detail page can
    // distinguish "cancelled_by_admin" from "cancelled_by_member" when
    // surfacing the row's status.
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledByAdminId: integer("cancelled_by_admin_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    // Set to true when the member cancelled or replaced their own pending
    // email change (POST /members/me/email/cancel or a follow-up POST
    // /members/me/email that supersedes the prior pending row). Stamped
    // together with `cancelledAt`. Distinguishes member-initiated cancels
    // from admin-initiated ones (which set `cancelledByAdminId` instead) and
    // from rows that simply expired or were abandoned without explicit
    // action (both flags stay false in those cases).
    cancelledByMember: boolean("cancelled_by_member").notNull().default(false),
    // When the member dismissed the in-app banner that surfaces this
    // admin-cancelled attempt on their account page. Set by
    // POST /members/me/email/admin-cancellation/dismiss so the banner
    // doesn't reappear on every page load. Only meaningful for rows where
    // `cancelledByAdminId IS NOT NULL`; we still keep the timestamp for
    // any row in case the dismissal semantics expand later.
    dismissedByMemberAt: timestamp("dismissed_by_member_at", {
      withTimezone: true,
    }),
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
