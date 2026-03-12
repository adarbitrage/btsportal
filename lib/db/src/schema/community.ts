import { pgTable, text, serial, integer, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const communityCategoriesTable = pgTable("community_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  postsCount: integer("posts_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommunityCategory = typeof communityCategoriesTable.$inferSelect;

export const communityPostsTable = pgTable("community_posts", {
  id: serial("id").primaryKey(),
  authorId: integer("author_id").notNull().references(() => usersTable.id),
  categoryId: integer("category_id").notNull().references(() => communityCategoriesTable.id),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  isPinned: boolean("is_pinned").notNull().default(false),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedBy: text("deleted_by"),
  commentCount: integer("comment_count").notNull().default(0),
  reactionCount: integer("reaction_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("community_posts_author_idx").on(table.authorId),
  index("community_posts_category_idx").on(table.categoryId),
  index("community_posts_created_idx").on(table.createdAt),
]);

export type CommunityPost = typeof communityPostsTable.$inferSelect;

export const communityCommentsTable = pgTable("community_comments", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull().references(() => communityPostsTable.id),
  authorId: integer("author_id").notNull().references(() => usersTable.id),
  parentId: integer("parent_id"),
  content: text("content").notNull(),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedBy: text("deleted_by"),
  reactionCount: integer("reaction_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("community_comments_post_idx").on(table.postId),
  index("community_comments_author_idx").on(table.authorId),
  index("community_comments_parent_idx").on(table.parentId),
]);

export type CommunityComment = typeof communityCommentsTable.$inferSelect;

export const communityReactionsTable = pgTable("community_reactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  postId: integer("post_id").references(() => communityPostsTable.id),
  commentId: integer("comment_id").references(() => communityCommentsTable.id),
  reactionType: text("reaction_type").notNull().default("fire"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("community_reactions_user_post_idx").on(table.userId, table.postId),
  uniqueIndex("community_reactions_user_comment_idx").on(table.userId, table.commentId),
]);

export type CommunityReaction = typeof communityReactionsTable.$inferSelect;

export const communityBadgesTable = pgTable("community_badges", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  badgeType: text("badge_type").notNull(),
  awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("community_badges_user_type_idx").on(table.userId, table.badgeType),
  index("community_badges_user_idx").on(table.userId),
]);

export type CommunityBadge = typeof communityBadgesTable.$inferSelect;

export const communityNotificationsTable = pgTable("community_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  actorId: integer("actor_id").references(() => usersTable.id),
  type: text("type").notNull(),
  postId: integer("post_id").references(() => communityPostsTable.id),
  commentId: integer("comment_id").references(() => communityCommentsTable.id),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("community_notifications_user_idx").on(table.userId),
  index("community_notifications_read_idx").on(table.userId, table.isRead),
]);

export type CommunityNotification = typeof communityNotificationsTable.$inferSelect;
