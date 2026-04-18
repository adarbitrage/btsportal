import { pgTable, text, integer, timestamp, serial } from "drizzle-orm/pg-core";

export const ghlOauthTokensTable = pgTable("ghl_oauth_tokens", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(),
  companyId: text("company_id"),
  locationId: text("location_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  userType: text("user_type"),
  scopes: text("scopes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdById: integer("created_by_id"),
});

export type GhlOauthToken = typeof ghlOauthTokensTable.$inferSelect;
export type InsertGhlOauthToken = typeof ghlOauthTokensTable.$inferInsert;
