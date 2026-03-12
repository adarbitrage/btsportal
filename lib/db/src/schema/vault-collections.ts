import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vaultCollectionsTable = pgTable("vault_collections", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id"),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  icon: text("icon"),
  coverImageUrl: text("cover_image_url"),
  requiredEntitlement: text("required_entitlement").default("content:frontend"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVaultCollectionSchema = createInsertSchema(vaultCollectionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVaultCollection = z.infer<typeof insertVaultCollectionSchema>;
export type VaultCollection = typeof vaultCollectionsTable.$inferSelect;
