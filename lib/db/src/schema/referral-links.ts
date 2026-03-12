import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { affiliateProfilesTable } from "./affiliate-profiles";
import { productsTable } from "./products";

export const referralLinksTable = pgTable("referral_links", {
  id: serial("id").primaryKey(),
  affiliateId: integer("affiliate_id").notNull().references(() => affiliateProfilesTable.id),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  slug: text("slug").notNull(),
  clickCount: integer("click_count").notNull().default(0),
  conversionCount: integer("conversion_count").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_referral_links_affiliate_product").on(table.affiliateId, table.productId),
  index("idx_referral_links_slug").on(table.slug),
]);

export const insertReferralLinkSchema = createInsertSchema(referralLinksTable).omit({ id: true, createdAt: true });
export type InsertReferralLink = z.infer<typeof insertReferralLinkSchema>;
export type ReferralLink = typeof referralLinksTable.$inferSelect;
