import { pgTable, text, serial, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vaultCollectionsTable } from "./vault-collections";

export const vaultResourcesTable = pgTable("vault_resources", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").notNull().references(() => vaultCollectionsTable.id),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  description: text("description").notNull().default(""),
  type: text("type").notNull().default("file"),
  fileUrl: text("file_url"),
  fileSize: integer("file_size").notNull().default(0),
  fileType: text("file_type"),
  externalUrl: text("external_url"),
  videoUrl: text("video_url"),
  markdownContent: text("markdown_content"),
  thumbnailUrl: text("thumbnail_url"),
  tags: text("tags").notNull().default("[]"),
  isFeatured: boolean("is_featured").notNull().default(false),
  requiredEntitlement: text("required_entitlement").notNull().default("content:frontend"),
  sortOrder: integer("sort_order").notNull().default(0),
  viewCount: integer("view_count").notNull().default(0),
  downloadCount: integer("download_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("vault_resources_collection_idx").on(table.collectionId),
  index("vault_resources_type_idx").on(table.type),
  index("vault_resources_featured_idx").on(table.isFeatured),
]);

export const insertVaultResourceSchema = createInsertSchema(vaultResourcesTable).omit({ id: true, createdAt: true, updatedAt: true, viewCount: true, downloadCount: true });
export type InsertVaultResource = z.infer<typeof insertVaultResourceSchema>;
export type VaultResource = typeof vaultResourcesTable.$inferSelect;
