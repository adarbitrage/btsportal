import { pgTable, text, serial, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").notNull().default("frontend"),
  thrivecartProductId: text("thrivecart_product_id"),
  entitlementKeys: jsonb("entitlement_keys").notNull().default([]),
  durationDays: integer("duration_days"),
  priceDisplay: text("price_display"),
  sortOrder: integer("sort_order").notNull().default(0),
  // Hosted checkout URL for upgrades from the /plans page. Stored per-product
  // so each tier can point at its own ThriveCart (or other provider) cart.
  // Nullable: products that aren't directly purchasable (or that we haven't
  // wired up a cart for yet) leave this blank and the API refuses to start
  // a checkout for them. The /members/me/checkout endpoint appends the
  // member's email/name and a return_url before redirecting.
  checkoutUrl: text("checkout_url"),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
