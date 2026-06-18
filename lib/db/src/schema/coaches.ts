import { pgTable, text, serial, integer, boolean, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Single unified coach roster. A coach can do group calls, private (credit-pack)
// coaching, or both — expressed via doesGroupCalls / doesPrivateCoaching. The
// private-coaching booking config (ghl*, sortOrder, isActive) is only meaningful
// when doesPrivateCoaching is true. This table replaces the former separate
// `session_pack_coaches` roster, so the same human is one row here regardless of
// what they do.
export const coachesTable = pgTable("coaches", {
  id: serial("id").primaryKey(),
  // First name shown to members (privacy: members see first names only).
  name: text("name").notNull(),
  // Optional link to the coach's portal login (usersTable.role === "coach").
  // Lets a signed-in coach be resolved to their coach record so coach-facing
  // surfaces (e.g. Group Coaching) can scope to "their own" calls. Nullable:
  // most roster coaches have no portal account yet. ON DELETE SET NULL so
  // deleting a user account leaves the coach row intact (just unlinked).
  userId: integer("user_id")
    .references(() => usersTable.id, { onDelete: "set null" })
    .unique(),
  // Internal-only record fields (never surfaced to members).
  fullName: text("full_name"),
  email: text("email"),
  bio: text("bio"),
  // Optional bio specific to private (credit-pack) coaching. Shown to members on
  // the private-coaching booking flow; falls back to the general `bio` when empty.
  privateCoachingBio: text("private_coaching_bio"),
  photoUrl: text("photo_url"),
  specialties: text("specialties"),
  // Capability switches — what this coach actually does.
  doesGroupCalls: boolean("does_group_calls").notNull().default(false),
  doesPrivateCoaching: boolean("does_private_coaching").notNull().default(false),
  // Private-coaching booking config (GoHighLevel). Only meaningful when
  // doesPrivateCoaching is true; null for group-only coaches.
  ghlCalendarId: text("ghl_calendar_id").unique(),
  ghlLocationId: text("ghl_location_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  meetLink: text("meet_link"),
  // Vestigial slot-engine columns retained to avoid churn in seed/tests; not
  // used by the live group-calls or private-coaching flows.
  callTypes: text("call_types").array().notNull().default([]),
  timezone: text("timezone").notNull().default("America/New_York"),
  maxDailySessions: integer("max_daily_sessions").notNull().default(4),
  averageRating: numeric("average_rating", { precision: 3, scale: 2 }),
  totalRatings: integer("total_ratings").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCoachSchema = createInsertSchema(coachesTable).omit({ id: true });
export type InsertCoach = z.infer<typeof insertCoachSchema>;
export type Coach = typeof coachesTable.$inferSelect;

// Back-compat alias: the private-coaching roster is now the same `coaches`
// table. Existing code that imported `sessionPackCoachesTable` keeps working
// while we migrate call sites to `coachesTable`.
export const sessionPackCoachesTable = coachesTable;
export type SessionPackCoach = Coach;
