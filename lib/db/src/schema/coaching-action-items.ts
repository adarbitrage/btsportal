import { pgTable, serial, integer, text, timestamp, date } from "drizzle-orm/pg-core";
import { coachingSessionsTable } from "./coaching-sessions";

export const coachingActionItemsTable = pgTable("coaching_action_items", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => coachingSessionsTable.id),
  text: text("text").notNull(),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CoachingActionItem = typeof coachingActionItemsTable.$inferSelect;
