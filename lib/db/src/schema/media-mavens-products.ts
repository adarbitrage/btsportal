import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const mediaMavensProductsTable = pgTable("media_mavens_products", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  category: text("category").notNull().default("Health"),
  imageUrl: text("image_url"),
  description: text("description").notNull().default(""),
  costToConsumer: text("cost_to_consumer").notNull().default(""),
  affiliateCommission: text("affiliate_commission").notNull().default(""),
  salesPageUrl: text("sales_page_url").notNull().default(""),
  logoDriveUrl: text("logo_drive_url").notNull().default(""),
  affiliateLink: text("affiliate_link").notNull().default(""),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("media_mavens_products_display_order_idx").on(table.displayOrder),
  index("media_mavens_products_is_active_idx").on(table.isActive),
  index("media_mavens_products_category_idx").on(table.category),
]);

export type MediaMavensProduct = typeof mediaMavensProductsTable.$inferSelect;
export const insertMediaMavensProductSchema = createInsertSchema(mediaMavensProductsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMediaMavensProduct = z.infer<typeof insertMediaMavensProductSchema>;
