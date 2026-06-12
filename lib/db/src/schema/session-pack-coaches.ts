import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";

// Standalone, credit-based 1-on-1 coaching roster. These coaches are booked
// against their real GoHighLevel calendars (sub-account JI6HzFwkNIr5VA2QUWUL),
// independent of mentorship entitlements. NOT related to the entitlement-gated
// `coaches` table used by the native slot-engine.
export const sessionPackCoachesTable = pgTable("session_pack_coaches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ghlCalendarId: text("ghl_calendar_id").notNull().unique(),
  ghlLocationId: text("ghl_location_id").notNull(),
  bio: text("bio"),
  photoUrl: text("photo_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SessionPackCoach = typeof sessionPackCoachesTable.$inferSelect;
