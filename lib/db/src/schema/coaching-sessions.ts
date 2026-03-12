import { pgTable, text, serial, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { coachesTable } from "./coaches";
import { usersTable } from "./users";

export const coachingSessionsTable = pgTable("coaching_sessions", {
  id: serial("id").primaryKey(),
  coachId: integer("coach_id").notNull().references(() => coachesTable.id),
  memberId: integer("member_id").notNull().references(() => usersTable.id),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  status: text("status").notNull().default("scheduled"),
  meetLink: text("meet_link"),
  coachNotes: text("coach_notes"),
  memberNotes: text("member_notes"),
  rating: integer("rating"),
  actionItems: jsonb("action_items").$type<ActionItem[]>().default([]),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: text("cancelled_by"),
  cancellationReason: text("cancellation_reason"),
  creditReturned: boolean("credit_returned").notNull().default(false),
  rescheduledFromId: integer("rescheduled_from_id"),
  rescheduledToId: integer("rescheduled_to_id"),
  reminder24hSent: boolean("reminder_24h_sent").notNull().default(false),
  reminder1hSent: boolean("reminder_1h_sent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("idx_coaching_session_coach").on(table.coachId),
  index("idx_coaching_session_member").on(table.memberId),
  index("idx_coaching_session_scheduled").on(table.scheduledAt),
  index("idx_coaching_session_status").on(table.status),
]);

export interface ActionItem {
  id: string;
  text: string;
  completed: boolean;
  completedAt?: string;
}

export type CoachingSession = typeof coachingSessionsTable.$inferSelect;
