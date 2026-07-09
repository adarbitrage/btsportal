import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Durable run reports for the Synthesis Engine (synthesis hardening — mirrors
 * kb_topic_index_runs). A synthesis run's progress, per-node outcomes and
 * failure reasons survive restarts, so "what happened on the last run" is never
 * only in process memory or console logs. Per-source extract failures are
 * recorded on kb_source_node_extracts (status='failed'); this table carries the
 * node-level view.
 */

/** One failed node in a synthesis run (durable, human-readable). */
export interface SynthesisRunFailure {
  node: string;
  error: string;
  /** Per-source extract failures that caused/accompanied the node failure. */
  sourceFailures?: Array<{ sourceDocId: number; error: string }>;
}

/** Per-node outcome recorded as the run progresses. */
export interface SynthesisRunNodeOutcome {
  node: string;
  outcome: "created" | "skipped" | "failed";
  draftId?: number | null;
  atomicDraftIds?: number[];
  sourceCount?: number;
  skippedReason?: string;
  error?: string;
  durationMs?: number;
}

export const kbSynthesisRunsTable = pgTable("kb_synthesis_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  // The requested scope description (e.g. "nodes", "incremental", "all").
  scope: text("scope").notNull().default("nodes"),
  totalNodes: integer("total_nodes").notNull().default(0),
  processedNodes: integer("processed_nodes").notNull().default(0),
  createdDrafts: integer("created_drafts").notNull().default(0),
  succeededCount: integer("succeeded_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  // Fatal run-level error (per-node failures live in `failures`).
  error: text("error"),
  // Per-node failure reasons (durable — survives restarts).
  failures: jsonb("failures").$type<SynthesisRunFailure[]>().notNull().default(sql`'[]'::jsonb`),
  // Full per-node outcome log (created/skipped/failed + timing).
  nodeOutcomes: jsonb("node_outcomes").$type<SynthesisRunNodeOutcome[]>().notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("kb_synthesis_runs_started_idx").on(table.startedAt),
]);

export type KbSynthesisRun = typeof kbSynthesisRunsTable.$inferSelect;
