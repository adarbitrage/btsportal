import { pgTable, text, serial, integer, timestamp, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { coachesTable } from "./coaches";
import { usersTable } from "./users";

// A recurring schedule definition ("every Monday 2pm, coach X, weekly_qa").
// Admins create ONE template and the system generates the next N weeks of
// ordinary `coaching_calls` rows from it. The template owns only the cadence +
// the field values copied onto each generated call; it never replaces those
// rows. Generated calls are plain `coaching_calls` rows (linked back via
// `template_id`), so editing or cancelling a single occurrence touches only
// that row and the rest of the series is undisturbed.
export const coachingCallTemplatesTable = pgTable("coaching_call_templates", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  callType: text("call_type").notNull().default("weekly_qa"),
  coachId: integer("coach_id").notNull().references(() => coachesTable.id),
  meetLink: text("meet_link"),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  requiredEntitlement: text("required_entitlement").notNull().default("coaching:group"),
  // Days between occurrences (7 = weekly). Kept generic so a future "every
  // other week" needs no schema change.
  intervalDays: integer("interval_days").notNull().default(7),
  // How many occurrences each "generate" pass creates.
  occurrencesPerBatch: integer("occurrences_per_batch").notNull().default(8),
  // The first occurrence's date/time; every generated call is anchorAt + k*interval.
  anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
  // Watermark: the scheduledAt of the furthest occurrence generated so far.
  // Generation only ever moves strictly forward from here, so a cancelled
  // occurrence is never re-created on a later "generate" pass.
  lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCoachingCallTemplateSchema = createInsertSchema(coachingCallTemplatesTable).omit({ id: true });
export type InsertCoachingCallTemplate = z.infer<typeof insertCoachingCallTemplateSchema>;
export type CoachingCallTemplate = typeof coachingCallTemplatesTable.$inferSelect;

export const coachingCallsTable = pgTable(
  "coaching_calls",
  {
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
    // Set on calls generated from a recurring template; NULL for one-off calls
    // created directly. ON DELETE SET NULL so removing a template leaves its
    // already-generated calls intact (they simply lose the series link).
    templateId: integer("template_id").references(() => coachingCallTemplatesTable.id, {
      onDelete: "set null",
    }),
    // Soft-cancel marker for a single occurrence. NULL = active/scheduled; set
    // = this date is cancelled (e.g. the coach is unavailable that week). The
    // row is intentionally KEPT, not deleted, so cancellation is reversible and
    // the (template_id, scheduled_at) slot stays occupied — which is what keeps
    // both regeneration paths (admin "Generate" watermark + the weekly Q&A boot
    // seed's existing-slot skip) from resurrecting the cancelled date.
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    // Who cancelled it (coach or admin). ON DELETE SET NULL so removing the
    // actor's account never deletes the call. NULL whenever cancelledAt is NULL.
    cancelledBy: integer("cancelled_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    // Idempotent generation: a template never produces two calls for the same
    // slot. NULLs are distinct in Postgres, so manual (template_id IS NULL)
    // calls are unaffected even if they share a scheduled_at.
    templateSlotUnq: unique("coaching_calls_template_slot_unq").on(t.templateId, t.scheduledAt),
  }),
);

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
