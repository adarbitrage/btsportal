import { pgTable, text, serial, integer, boolean, timestamp, jsonb, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const apiKeysTable = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull().unique(),
    keyHash: text("key_hash").notNull(),
    type: text("type").notNull().default("secret"),
    environment: text("environment").notNull().default("live"),
    permissions: jsonb("permissions").notNull().$type<string[]>().default([]),
    rateLimitTier: text("rate_limit_tier").notNull().default("standard"),
    createdById: integer("created_by_id").notNull().references(() => usersTable.id),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revoked: boolean("revoked").notNull().default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedById: integer("revoked_by_id").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    // Pin the storage shape of `permissions` to a JSONB array. Without this
    // constraint, a stray `JSON.stringify([...])` on the way in lands a
    // JSONB string scalar — which Drizzle silently re-parses on the way
    // out, but breaks raw SQL JSONB operators (`@>`, `?`,
    // `jsonb_array_elements_text`) and would silently grant zero
    // permissions to whoever holds this key. Reject the bad shape at the
    // database layer. Mirrors the guard added in 0022 for
    // `products.entitlement_keys`. See #329 for the original incident.
    permissionsIsArray: check(
      "api_keys_permissions_is_array",
      sql`jsonb_typeof(${table.permissions}) = 'array'`,
    ),
  }),
);

export type ApiKey = typeof apiKeysTable.$inferSelect;
export type InsertApiKey = typeof apiKeysTable.$inferInsert;
