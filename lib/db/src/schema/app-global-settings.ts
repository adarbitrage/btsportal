import { pgTable, text, boolean, integer, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { APP_NAMES } from "./member-app-instances";

export const appGlobalSettingsTable = pgTable(
  "app_global_settings",
  {
    appName: text("app_name").primaryKey(),
    enabled: boolean("enabled").notNull().default(true),
    visible: boolean("visible").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedById: integer("updated_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    updatedByEmail: text("updated_by_email"),
  },
  (table) => [
    // Pin `app_name` to the current allowlist. The original constraint was
    // created inline in 0005 with an allowlist that pre-dated the Flexy
    // rollout; migration 0036 refreshes the constraint on already-migrated
    // databases to include `'flexy'` so this `check()` and `drizzle-kit
    // push` produce the same constraint set as running all migrations.
    check(
      "app_global_settings_app_name_check",
      sql`${table.appName} IN ('diytrax','pixelpress','gifster','metricmover','noescape','flexy')`,
    ),
  ],
);

export type AppGlobalSetting = typeof appGlobalSettingsTable.$inferSelect;
export type InsertAppGlobalSetting = typeof appGlobalSettingsTable.$inferInsert;

export { APP_NAMES };
