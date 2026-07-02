import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Accountability-partner roster. Mirrors the shape of `coaches` — partners
// are a distinct role from coaches (partners run the ongoing accountability
// check-ins for 3-Month+ members; coaches run group/private coaching calls).
// Starts with 3 partners but nothing may assume a fixed headcount — the
// round-robin balancer (see lib/partner-assignment.ts) scales to any count.
export const partnersTable = pgTable("partners", {
  id: serial("id").primaryKey(),
  // Optional link to the partner's portal login. Nullable: a partner can be
  // seeded before they have a portal account. ON DELETE SET NULL so deleting
  // a user account leaves the partner row (and their assignment history)
  // intact — just unlinked.
  userId: integer("user_id")
    .references(() => usersTable.id, { onDelete: "set null" })
    .unique(),
  displayName: text("display_name").notNull(),
  photoUrl: text("photo_url"),
  bio: text("bio"),
  isActive: boolean("is_active").notNull().default(true),
  // Soft capacity ceiling for the Tier 2 booking/reveal UI (not enforced by
  // round-robin assignment itself, which balances by count, not by this cap).
  maxDailyCalls: integer("max_daily_calls").notNull().default(5),
  // GHL calendar to book partner calls against (Tier 2). Nullable — a partner
  // without a calendar configured simply offers no bookable slots.
  ghlCalendarId: text("ghl_calendar_id"),
  // GHL sub-account location that owns `ghlCalendarId` (Task #1611). Not
  // every calendar lives in the coaching location — a token minted for the
  // wrong location 401s — so every calendar-owning row must carry its own
  // location instead of assuming the shared coaching one. Defaults to the
  // coaching location (JI6HzFwkNIr5VA2QUWUL, see COACHING_LOCATION_ID in
  // ghl-coaching-calendar.ts) so pre-existing rows/behavior are unchanged.
  ghlLocationId: text("ghl_location_id").notNull().default("JI6HzFwkNIr5VA2QUWUL"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertPartnerSchema = createInsertSchema(partnersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPartner = z.infer<typeof insertPartnerSchema>;
export type Partner = typeof partnersTable.$inferSelect;
