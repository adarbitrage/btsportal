import { pgTable, text, serial, integer, timestamp, unique, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
  (table) => [
    unique("member_app_instances_user_app_unique").on(table.userId, table.appName),
    // Backs the per-member dashboard query (list every app a given member
    // has provisioned). Mirrors the raw-SQL index created inline in
    // 0004_squidy_member_app_instances.sql so `drizzle-kit push` produces
    // the same constraint set as running all migrations.
    index("member_app_instances_user_id_idx").on(table.userId),
    // Backs the admin "installs in progress / failed installs" filters that
    // bucket rows by status. Mirrors the raw-SQL index created inline in
    // 0004_squidy_member_app_instances.sql so `drizzle-kit push` produces
    // the same constraint set as running all migrations.
    index("member_app_instances_status_idx").on(table.status),
    // Pin `app_name` to the current allowlist. The original constraint was
    // created inline in 0004 with an allowlist that pre-dated the Flexy
    // rollout; migration 0036 refreshes the constraint on already-migrated
    // databases to include `'flexy'` so this `check()` and `drizzle-kit
    // push` produce the same constraint set as running all migrations.
    check(
      "member_app_instances_app_name_check",
      sql`${table.appName} IN ('diytrax','pixelpress','gifster','metricmover','noescape','flexy')`,
    ),
    // Pin `status` to the current allowlist. Same rationale as the
    // `app_name` check above — the original 0004 constraint pre-dated the
    // `'uninstalling'` status and is refreshed in migration 0036 so both
    // code paths produce the same constraint set.
    check(
      "member_app_instances_status_check",
      sql`${table.status} IN ('not_installed','installing','installed','install_failed','uninstalling')`,
    ),
  ],
);

export type MemberAppInstance = typeof memberAppInstancesTable.$inferSelect;
export type InsertMemberAppInstance = typeof memberAppInstancesTable.$inferInsert;
