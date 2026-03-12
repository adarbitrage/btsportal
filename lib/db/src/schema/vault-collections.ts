import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vaultCollectionsTable = pgTable("vault_collections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull().default("folder"),
  parentId: integer("parent_id"),
  requiredEntitlement: text("required_entitlement").notNull().default("content:frontend"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVaultCollectionSchema = createInsertSchema(vaultCollectionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVaultCollection = z.infer<typeof insertVaultCollectionSchema>;
export type VaultCollection = typeof vaultCollectionsTable.$inferSelect;
