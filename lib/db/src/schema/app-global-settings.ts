import { pgTable, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { APP_NAMES } from "./member-app-instances";

export const appGlobalSettingsTable = pgTable("app_global_settings", {
  appName: text("app_name").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  visible: boolean("visible").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedById: integer("updated_by_id").references(() => usersTable.id),
  updatedByEmail: text("updated_by_email"),
});

export type AppGlobalSetting = typeof appGlobalSettingsTable.$inferSelect;
export type InsertAppGlobalSetting = typeof appGlobalSettingsTable.$inferInsert;

export { APP_NAMES };
