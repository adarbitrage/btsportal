import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { coachesTable } from "./coaches";
import { usersTable } from "./users";

export const coachingCallsTable = pgTable("coaching_calls", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  callType: text("call_type").notNull().default("weekly_qa"),
  coachId: integer("coach_id").notNull().references(() => coachesTable.id),
  meetLink: text("meet_link"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  requiredEntitlement: text("required_entitlement").notNull().default("coaching:group"),
  recordingUrl: text("recording_url"),
  registeredCount: integer("registered_count").notNull().default(0),
});

export const insertCoachingCallSchema = createInsertSchema(coachingCallsTable).omit({ id: true });
export type InsertCoachingCall = z.infer<typeof insertCoachingCallSchema>;
export type CoachingCall = typeof coachingCallsTable.$inferSelect;

// Per-member participation in a coaching call. A row is created the first time a
// member registers for / joins the live call (registeredAt) or opens the
// recording (recordingViewedAt); both timestamps live on the same row so a
// member maps to at most one attendance record per call (unique call+user).
//
// This is what lets scheduled-comms target the RIGHT members:
//   - session-feedback prompts go to people who actually attended or watched
//   - "recording ready" notifications go to people who registered for the call
// instead of fanning out to everyone merely entitled to it.
export const coachingCallAttendanceTable = pgTable(
  "coaching_call_attendance",
  {
    id: serial("id").primaryKey(),
    callId: integer("call_id")
      .notNull()
      .references(() => coachingCallsTable.id),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    // Set when the member registers for / joins the live call.
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    // Set when the member opens the call's recording.
    recordingViewedAt: timestamp("recording_viewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCallUser: unique("coaching_call_attendance_call_user_unq").on(t.callId, t.userId),
  })
);

export const insertCoachingCallAttendanceSchema = createInsertSchema(coachingCallAttendanceTable).omit({ id: true });
export type InsertCoachingCallAttendance = z.infer<typeof insertCoachingCallAttendanceSchema>;
export type CoachingCallAttendance = typeof coachingCallAttendanceTable.$inferSelect;
