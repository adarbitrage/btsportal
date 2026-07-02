import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Kickoff-coach roster. Kickoff calls (the first onboarding call for a new
// 3-Month+ member) are run by dedicated kickoff coaches, NOT accountability
// partners — this table is deliberately separate from both `coaches` and
// `partners`. This task only provides the data (photo + bio, queryable);
// round-robin booking assignment across kickoff coaches is a Tier 2 task.
export const kickoffCoachesTable = pgTable("kickoff_coaches", {
  id: serial("id").primaryKey(),
  // Optional link to the kickoff coach's portal login. Nullable + ON DELETE
  // SET NULL, mirroring coaches/partners.
  userId: integer("user_id")
    .references(() => usersTable.id, { onDelete: "set null" })
    .unique(),
  displayName: text("display_name").notNull(),
  photoUrl: text("photo_url"),
  bio: text("bio"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  // GHL calendar to book kickoff calls against (Tier 2). Nullable — a coach
  // without a calendar configured simply offers no bookable slots and is
  // skipped by round-robin selection.
  ghlCalendarId: text("ghl_calendar_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertKickoffCoachSchema = createInsertSchema(kickoffCoachesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertKickoffCoach = z.infer<typeof insertKickoffCoachSchema>;
export type KickoffCoach = typeof kickoffCoachesTable.$inferSelect;
