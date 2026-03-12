import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const affiliateProfilesTable = pgTable("affiliate_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id).unique(),
  affiliateCode: text("affiliate_code").notNull().unique(),
  tier: text("tier").notNull().default("entry"),
  status: text("status").notNull().default("active"),
  paypalEmail: text("paypal_email"),
  taxFormSubmitted: boolean("tax_form_submitted").notNull().default(false),
  taxFormUrl: text("tax_form_url"),
  totalEarnings: integer("total_earnings").notNull().default(0),
  totalPaid: integer("total_paid").notNull().default(0),
  pendingBalance: integer("pending_balance").notNull().default(0),
  approvedBalance: integer("approved_balance").notNull().default(0),
  lifetimeClicks: integer("lifetime_clicks").notNull().default(0),
  lifetimeConversions: integer("lifetime_conversions").notNull().default(0),
  fraudFlag: boolean("fraud_flag").notNull().default(false),
  fraudReason: text("fraud_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("idx_affiliate_profiles_code").on(table.affiliateCode),
  index("idx_affiliate_profiles_user").on(table.userId),
  index("idx_affiliate_profiles_status").on(table.status),
]);

export const insertAffiliateProfileSchema = createInsertSchema(affiliateProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAffiliateProfile = z.infer<typeof insertAffiliateProfileSchema>;
export type AffiliateProfile = typeof affiliateProfilesTable.$inferSelect;
