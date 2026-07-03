import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  phone: text("phone"),
  timezone: text("timezone").default("America/New_York"),
  role: text("role").notNull().default("member"),
  sourceProduct: text("source_product"),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  onboardingStep: integer("onboarding_step").notNull().default(1),
  // Which onboarding step-contract array this member follows (Task #1640):
  //   "none"      — no onboarding at all (no active product, or frontend-only
  //                 rank-0 product); onboardingComplete is set true at creation.
  //   "launchpad" — the 4-step LaunchPad contract (welcome, profile,
  //                 kickoff_booked, pillars_watched).
  //   "full"      — the original 6-step contract (unchanged numbering).
  // Defaults to "full" so every pre-existing row (all created under the old
  // single-contract flow) keeps its current behavior untouched. Resolved at
  // creation time via resolveOnboardingVariant() based on the member's
  // highest-ranked active product (see lib/onboarding-variant.ts in
  // api-server) — NOT recomputed live on every read, so an upgrade mid-flow
  // does not silently reshuffle an in-progress member's step array (that
  // re-entry behavior is explicitly deferred to a later upgrade-hook task).
  onboardingVariant: text("onboarding_variant").notNull().default("full"),
  experienceLevel: text("experience_level"),
  primaryGoal: text("primary_goal"),
  smsOptIn: boolean("sms_opt_in").notNull().default(false),
  ticketReplySmsOptIn: boolean("ticket_reply_sms_opt_in").notNull().default(true),
  securitySmsOptIn: boolean("security_sms_opt_in").notNull().default(true),
  billingSmsOptIn: boolean("billing_sms_opt_in").notNull().default(true),
  coachingSmsOptIn: boolean("coaching_sms_opt_in").notNull().default(true),
  contentSmsOptIn: boolean("content_sms_opt_in").notNull().default(false),
  // Governs texts for BOTH kickoff-call and accountability-partner-call
  // reminders (Task #1628) — one category covers both variants, matching how
  // the call_bookings table itself treats them as one "call" concept with a
  // `type` discriminator.
  partnerCallSmsOptIn: boolean("partner_call_sms_opt_in").notNull().default(true),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifyToken: text("email_verify_token"),
  emailVerifyExpires: timestamp("email_verify_expires", { withTimezone: true }),
  resetToken: text("reset_token"),
  resetTokenExpires: timestamp("reset_token_expires", { withTimezone: true }),
  pendingEmail: text("pending_email"),
  emailChangeToken: text("email_change_token"),
  emailChangeExpires: timestamp("email_change_expires", { withTimezone: true }),
  currentStreak: integer("current_streak").notNull().default(0),
  memberSince: timestamp("member_since", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  communityBio: text("community_bio"),
  ghlContactId: text("ghl_contact_id"),
  tapfiliateAffiliateId: text("tapfiliate_affiliate_id"),
  marketingOptIn: boolean("marketing_opt_in").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  postingBannedAt: timestamp("posting_banned_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
