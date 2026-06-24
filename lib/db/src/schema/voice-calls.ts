import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const voiceCallsTable = pgTable("voice_calls", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  retellCallId: text("retell_call_id").notNull().unique(),
  callType: text("call_type").notNull().default("web"),
  callerPhone: text("caller_phone"),
  status: text("status").notNull().default("registered"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  transcript: text("transcript"),
  summary: text("summary"),
  disconnectReason: text("disconnect_reason"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VoiceCall = typeof voiceCallsTable.$inferSelect;
export type InsertVoiceCall = typeof voiceCallsTable.$inferInsert;
