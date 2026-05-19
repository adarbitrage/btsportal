import { pgTable, text, serial, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const affiliateNetworksTable = pgTable("affiliate_networks", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  description: text("description").notNull().default(""),
  logoUrl: text("logo_url"),
  logoBg: text("logo_bg").notNull().default("bg-white"),
  highlights: jsonb("highlights").notNull().default([]).$type<string[]>(),
  publishers: text("publishers").notNull().default(""),
  approvalLabel: text("approval_label").notNull().default(""),
  recommendedForBeginners: boolean("recommended_for_beginners").notNull().default(false),
  accentPreset: text("accent_preset").notNull().default("emerald"),
  accentBorder: text("accent_border").notNull().default("border-emerald-300"),
  accentBadgeBg: text("accent_badge_bg").notNull().default("bg-emerald-50"),
  accentBadgeText: text("accent_badge_text").notNull().default("text-emerald-800"),
  accentBadgeBorder: text("accent_badge_border").notNull().default("border-emerald-200"),
  registerUrl: text("register_url"),
  loginUrl: text("login_url"),
  extraCtaLabel: text("extra_cta_label"),
  extraCtaHref: text("extra_cta_href"),
  extraCtaStyle: text("extra_cta_style").notNull().default("default"),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("affiliate_networks_display_order_idx").on(table.displayOrder),
  index("affiliate_networks_is_active_idx").on(table.isActive),
]);

export type AffiliateNetwork = typeof affiliateNetworksTable.$inferSelect;
export const insertAffiliateNetworkSchema = createInsertSchema(affiliateNetworksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAffiliateNetwork = z.infer<typeof insertAffiliateNetworkSchema>;
