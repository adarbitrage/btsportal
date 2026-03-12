import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { referralLinksTable } from "./referral-links";

export const referralClicksTable = pgTable("referral_clicks", {
  id: serial("id").primaryKey(),
  referralLinkId: integer("referral_link_id").notNull().references(() => referralLinksTable.id),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  referer: text("referer"),
  clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_referral_clicks_link").on(table.referralLinkId),
  index("idx_referral_clicks_ip_time").on(table.ipAddress, table.clickedAt),
]);

export const insertReferralClickSchema = createInsertSchema(referralClicksTable).omit({ id: true });
export type InsertReferralClick = z.infer<typeof insertReferralClickSchema>;
export type ReferralClick = typeof referralClicksTable.$inferSelect;
