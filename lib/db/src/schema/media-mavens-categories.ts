import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const mediaMavensCategoriesTable = pgTable("media_mavens_categories", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("media_mavens_categories_display_order_idx").on(table.displayOrder),
  index("media_mavens_categories_is_active_idx").on(table.isActive),
]);

export type MediaMavensCategory = typeof mediaMavensCategoriesTable.$inferSelect;
export const insertMediaMavensCategorySchema = createInsertSchema(mediaMavensCategoriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMediaMavensCategory = z.infer<typeof insertMediaMavensCategorySchema>;
