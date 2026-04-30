import { pgTable, text, serial, integer, boolean, timestamp, jsonb, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vaultCollectionsTable } from "./vault-collections";

export const vaultResourcesTable = pgTable(
  "vault_resources",
  {
    id: serial("id").primaryKey(),
    collectionId: integer("collection_id").references(() => vaultCollectionsTable.id),
    title: text("title").notNull(),
    description: text("description"),
    longDescription: text("long_description"),
    resourceType: text("resource_type").notNull().default("document"),
    fileUrl: text("file_url"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    fileType: text("file_type"),
    previewImageUrl: text("preview_image_url"),
    contentHtml: text("content_html"),
    externalUrl: text("external_url"),
    videoUrl: text("video_url"),
    tags: jsonb("tags").$type<string[]>().default([]),
    requiredEntitlement: text("required_entitlement").default("content:frontend"),
    isFeatured: boolean("is_featured").notNull().default(false),
    isPinned: boolean("is_pinned").notNull().default(false),
    isNew: boolean("is_new").notNull().default(true),
    status: text("status").notNull().default("draft"),
    version: text("version"),
    updateNote: text("update_note"),
    downloadCount: integer("download_count").notNull().default(0),
    favoriteCount: integer("favorite_count").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Pin the storage shape of `tags` to a JSONB array (or NULL — tags are
    // optional). The original `seed-vault.ts` passed
    // `tags: JSON.stringify([...])` for every row, so Drizzle's jsonb mapper
    // double-encoded the value into a JSONB string scalar. Drizzle's reader
    // silently parsed it back into an array on the way out, but the admin
    // tag-listing endpoint (`Array.isArray(r.tags)`) saw a string and
    // dropped every tag from those rows. Reject the bad shape at the
    // database layer so it cannot come back. Mirrors the guard added in
    // 0022 for `products.entitlement_keys`. NOTE: this constraint will fail
    // to attach if any existing row is still a string scalar — the
    // 0027 data migration must have been applied first.
    tagsIsArray: check(
      "vault_resources_tags_is_array",
      sql`${table.tags} IS NULL OR jsonb_typeof(${table.tags}) = 'array'`,
    ),
  }),
);

export const insertVaultResourceSchema = createInsertSchema(vaultResourcesTable).omit({ id: true, createdAt: true, updatedAt: true, downloadCount: true, favoriteCount: true });
export type InsertVaultResource = z.infer<typeof insertVaultResourceSchema>;
export type VaultResource = typeof vaultResourcesTable.$inferSelect;

export const vaultResourceDownloadsTable = pgTable("vault_resource_downloads", {
  id: serial("id").primaryKey(),
  resourceId: integer("resource_id").notNull().references(() => vaultResourcesTable.id),
  userId: integer("user_id").notNull(),
  downloadedAt: timestamp("downloaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vaultResourceFavoritesTable = pgTable("vault_resource_favorites", {
  id: serial("id").primaryKey(),
  resourceId: integer("resource_id").notNull().references(() => vaultResourcesTable.id),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vaultResourceLessonRelationsTable = pgTable("vault_resource_lesson_relations", {
  id: serial("id").primaryKey(),
  resourceId: integer("resource_id").notNull().references(() => vaultResourcesTable.id),
  lessonId: integer("lesson_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vaultSearchQueriesTable = pgTable("vault_search_queries", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  resultCount: integer("result_count").notNull().default(0),
  userId: integer("user_id"),
  searchedAt: timestamp("searched_at", { withTimezone: true }).notNull().defaultNow(),
});
