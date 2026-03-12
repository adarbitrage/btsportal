import { pgTable, text, serial, integer, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const coachesTable = pgTable("coaches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  bio: text("bio").notNull(),
  photoUrl: text("photo_url"),
  specialties: text("specialties").notNull(),
  callTypes: text("call_types").array().notNull().default([]),
  timezone: text("timezone").notNull().default("America/New_York"),
  maxDailySessions: integer("max_daily_sessions").notNull().default(4),
  oneOnOneEnabled: boolean("one_on_one_enabled").notNull().default(false),
  meetLink: text("meet_link"),
  averageRating: numeric("average_rating", { precision: 3, scale: 2 }),
  totalRatings: integer("total_ratings").notNull().default(0),
});

export const insertCoachSchema = createInsertSchema(coachesTable).omit({ id: true });
export type InsertCoach = z.infer<typeof insertCoachSchema>;
export type Coach = typeof coachesTable.$inferSelect;
