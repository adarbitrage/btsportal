import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const affiliateResourcesTable = pgTable("affiliate_resources", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  content: text("content"),
  fileUrl: text("file_url"),
  thumbnailUrl: text("thumbnail_url"),
  productSlug: text("product_slug"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("idx_affiliate_resources_type").on(table.type),
  index("idx_affiliate_resources_status").on(table.status),
]);

export const insertAffiliateResourceSchema = createInsertSchema(affiliateResourcesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAffiliateResource = z.infer<typeof insertAffiliateResourceSchema>;
export type AffiliateResource = typeof affiliateResourcesTable.$inferSelect;
