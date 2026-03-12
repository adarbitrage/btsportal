import { pgTable, text, serial, integer, numeric, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const memberHealthScoresTable = pgTable("member_health_scores", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  score: integer("score").notNull(),
  riskLevel: text("risk_level").notNull(),
  loginFrequencyScore: numeric("login_frequency_score", { precision: 5, scale: 2 }),
  trainingProgressScore: numeric("training_progress_score", { precision: 5, scale: 2 }),
  coachingAttendanceScore: numeric("coaching_attendance_score", { precision: 5, scale: 2 }),
  communityEngagementScore: numeric("community_engagement_score", { precision: 5, scale: 2 }),
  toolUsageScore: numeric("tool_usage_score", { precision: 5, scale: 2 }),
  supportTicketScore: numeric("support_ticket_score", { precision: 5, scale: 2 }),
  recencyScore: numeric("recency_score", { precision: 5, scale: 2 }),
  signals: jsonb("signals"),
  previousScore: integer("previous_score"),
  trend: text("trend"),
  churnProbability: numeric("churn_probability", { precision: 5, scale: 4 }),
  upgradeProbability: numeric("upgrade_probability", { precision: 5, scale: 4 }),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_health_scores_user").on(table.userId),
  index("idx_health_scores_risk").on(table.riskLevel),
  index("idx_health_scores_computed").on(table.computedAt),
]);

export const insertMemberHealthScoreSchema = createInsertSchema(memberHealthScoresTable).omit({ id: true });
export type InsertMemberHealthScore = z.infer<typeof insertMemberHealthScoreSchema>;
export type MemberHealthScore = typeof memberHealthScoresTable.$inferSelect;
