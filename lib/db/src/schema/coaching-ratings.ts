import { pgTable, text, serial, integer, timestamp, index, unique } from "drizzle-orm/pg-core";
import { coachesTable } from "./coaches";
import { usersTable } from "./users";
import { coachingSessionsTable } from "./coaching-sessions";

export const coachingRatingsTable = pgTable("coaching_ratings", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => coachingSessionsTable.id),
  coachId: integer("coach_id").notNull().references(() => coachesTable.id),
  memberId: integer("member_id").notNull().references(() => usersTable.id),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_coaching_rating_coach").on(table.coachId),
  unique("uq_coaching_rating_session").on(table.sessionId),
]);

export type CoachingRating = typeof coachingRatingsTable.$inferSelect;
