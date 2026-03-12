import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { coachesTable } from "./coaches";

export const coachingCallsTable = pgTable("coaching_calls", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  callType: text("call_type").notNull().default("weekly_qa"),
  coachId: integer("coach_id").notNull().references(() => coachesTable.id),
  meetLink: text("meet_link"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  minimumTier: text("minimum_tier").notNull().default("bronze"),
  recordingUrl: text("recording_url"),
  registeredCount: integer("registered_count").notNull().default(0),
});

export const insertCoachingCallSchema = createInsertSchema(coachingCallsTable).omit({ id: true });
export type InsertCoachingCall = z.infer<typeof insertCoachingCallSchema>;
export type CoachingCall = typeof coachingCallsTable.$inferSelect;
