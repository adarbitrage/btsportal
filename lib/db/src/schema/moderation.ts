import { pgTable, text, serial, integer, timestamp, index, jsonb, real } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { communityPostsTable } from "./community";
import { communityCommentsTable } from "./community";

export const moderationWordlistTable = pgTable("moderation_wordlist", {
  id: serial("id").primaryKey(),
  word: text("word").notNull().unique(),
  category: text("category").notNull(),
  severity: text("severity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("moderation_wordlist_severity_idx").on(table.severity),
  index("moderation_wordlist_category_idx").on(table.category),
]);

export type ModerationWordlist = typeof moderationWordlistTable.$inferSelect;

export const moderationQueueTable = pgTable("moderation_queue", {
  id: serial("id").primaryKey(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  authorId: integer("author_id").notNull().references(() => usersTable.id),
  body: text("body").notNull(),
  status: text("status").notNull().default("pending"),
  triggeredBy: text("triggered_by").notNull(),
  wordlistMatches: jsonb("wordlist_matches").notNull().default([]),
  aiScores: jsonb("ai_scores").notNull().default({}),
  // Threshold value in effect at the moment this item was flagged. Persisted
  // (rather than re-fetched at read time) so the "AI Flagged" admin view can
  // show what threshold each historical flag was judged against — admins can
  // tell whether a previous threshold setting was catching too much or too
  // little. Nullable because wordlist-only flags ("wordlist_hard" /
  // "wordlist_soft") short-circuit the AI classifier and therefore have no
  // meaningful threshold to record. Older rows pre-dating this column are
  // also null.
  flagThreshold: real("flag_threshold"),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("moderation_queue_status_idx").on(table.status),
  index("moderation_queue_author_idx").on(table.authorId),
  index("moderation_queue_target_idx").on(table.targetType, table.targetId),
  index("moderation_queue_created_idx").on(table.createdAt),
]);

export type ModerationQueue = typeof moderationQueueTable.$inferSelect;

export const userStrikesTable = pgTable("user_strikes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  reason: text("reason").notNull(),
  queueId: integer("queue_id").references(() => moderationQueueTable.id),
  targetType: text("target_type"),
  targetId: integer("target_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("user_strikes_user_idx").on(table.userId),
  index("user_strikes_created_idx").on(table.createdAt),
]);

export type UserStrike = typeof userStrikesTable.$inferSelect;
