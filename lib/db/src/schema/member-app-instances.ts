import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const APP_NAMES = ["diytrax", "pixelpress", "gifster", "metricmover", "noescape", "flexy"] as const;
export type AppName = (typeof APP_NAMES)[number];

export const APP_STATUSES = ["not_installed", "installing", "installed", "install_failed", "uninstalling"] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export const memberAppInstancesTable = pgTable(
  "member_app_instances",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    appName: text("app_name").notNull(),
    status: text("status").notNull().default("not_installed"),
    domain: text("domain"),
    appUuid: text("app_uuid"),
    squidyStatus: text("squidy_status"),
    squidySubStatus: text("squidy_sub_status"),
    lastLookupAt: timestamp("last_lookup_at", { withTimezone: true }),
    squidyError: text("squidy_error"),
    providerLocationId: text("provider_location_id"),
    providerStaffUserId: text("provider_staff_user_id"),
    providerStaffEmail: text("provider_staff_email"),
    providerStaffPasswordEncrypted: text("provider_staff_password_encrypted"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique("member_app_instances_user_app_unique").on(table.userId, table.appName)],
);

export type MemberAppInstance = typeof memberAppInstancesTable.$inferSelect;
export type InsertMemberAppInstance = typeof memberAppInstancesTable.$inferInsert;
