import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { vaultResourcesTable } from "./vault-resources";

export const vaultFavoritesTable = pgTable("vault_favorites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  resourceId: integer("resource_id").notNull().references(() => vaultResourcesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("vault_favorites_user_resource").on(table.userId, table.resourceId),
]);

export const insertVaultFavoriteSchema = createInsertSchema(vaultFavoritesTable).omit({ id: true, createdAt: true });
export type InsertVaultFavorite = z.infer<typeof insertVaultFavoriteSchema>;
export type VaultFavorite = typeof vaultFavoritesTable.$inferSelect;
