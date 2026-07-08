import { pgTable, text, serial, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

// ── Navigation-gap flags (Task #1776) ────────────────────────────────────────
// Advisory flags emitted by the synthesis pipeline when member-performed
// actions in a vocabulary app (kb-nav-vocabulary) have no published navigation
// doc covering that (app, area). Durable so re-runs UPDATE counts instead of
// duplicating rows; dismissals are sticky (a dismissed flag is never re-raised);
// publishing a nav doc that declares coverage auto-resolves matching open rows.
// NEVER a publish blocker — purely a reviewer to-do list.
export const kbNavGapFlagsTable = pgTable("kb_nav_gap_flags", {
  id: serial("id").primaryKey(),
  // App slug from the fixed code vocabulary (kb-nav-vocabulary NAV_APPS).
  app: text("app").notNull(),
  // Free-form normalized area label ('general' fallback). Aggregation key half.
  area: text("area").notNull().default("general"),
  // 'open' | 'dismissed' | 'resolved'. Dismissed is sticky across runs.
  status: text("status").notNull().default("open"),
  // 1 = Tier-1 app (normal priority), 2 = Tier-2 (lower priority).
  tier: integer("tier").notNull().default(1),
  // Distinct taxonomy nodes whose synthesis referenced this (app, area).
  topicNodes: jsonb("topic_nodes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  topicCount: integer("topic_count").notNull().default(0),
  // Short evidence snippet from the most recent detection (reviewer context).
  lastEvidence: text("last_evidence"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  dismissedBy: integer("dismissed_by").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  // The published ai_live_documents nav doc that resolved this flag (soft ref).
  resolvedByDocId: integer("resolved_by_doc_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("kb_nav_gap_flags_app_area_uniq").on(table.app, table.area),
  index("kb_nav_gap_flags_status_idx").on(table.status),
]);

export type KbNavGapFlag = typeof kbNavGapFlagsTable.$inferSelect;
export type InsertKbNavGapFlag = typeof kbNavGapFlagsTable.$inferInsert;
