import { pgTable, text, serial, integer, boolean, timestamp, date, decimal, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { communityPostsTable } from "./community";

export const winMilestonesTable = pgTable("win_milestones", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"),
  category: text("category").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  xpReward: integer("xp_reward").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WinMilestone = typeof winMilestonesTable.$inferSelect;

export const winsTable = pgTable("wins", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  milestoneId: integer("milestone_id").notNull().references(() => winMilestonesTable.id),

  title: text("title").notNull(),
  description: text("description").notNull(),

  revenueAmount: decimal("revenue_amount", { precision: 12, scale: 2 }),
  metricLabel: text("metric_label"),
  metricValue: text("metric_value"),

  proofImageUrl: text("proof_image_url"),
  proofImage2Url: text("proof_image_2_url"),
  proofVerified: boolean("proof_verified").notNull().default(false),

  winDate: date("win_date").notNull(),

  shareToCommunity: boolean("share_to_community").notNull().default(true),
  communityPostId: integer("community_post_id").references(() => communityPostsTable.id),
  allowTestimonial: boolean("allow_testimonial").notNull().default(false),
  allowPublicName: boolean("allow_public_name").notNull().default(false),

  status: text("status").notNull().default("published"),

  featuredAt: timestamp("featured_at", { withTimezone: true }),
  featuredBy: integer("featured_by").references(() => usersTable.id),

  testimonialRequested: boolean("testimonial_requested").notNull().default(false),
  testimonialText: text("testimonial_text"),
  testimonialApproved: boolean("testimonial_approved").notNull().default(false),
  testimonialApprovedBy: integer("testimonial_approved_by").references(() => usersTable.id),
  testimonialApprovedAt: timestamp("testimonial_approved_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("wins_user_created_idx").on(table.userId, table.createdAt),
  index("wins_milestone_created_idx").on(table.milestoneId, table.createdAt),
  index("wins_status_created_idx").on(table.status, table.createdAt),
  index("wins_testimonial_featured_idx").on(table.testimonialApproved, table.featuredAt),
]);

export type Win = typeof winsTable.$inferSelect;
