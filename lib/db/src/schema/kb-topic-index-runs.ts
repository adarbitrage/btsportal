import { pgTable, text, serial, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { aiSourceDocumentsTable } from "./ai-source-documents";

// ── Topic-index run reports + per-source classification state (Task #1794) ──
//
// The topic-index pipeline used to keep run progress only in module memory, so
// LLM classification failures were invisible after a restart and there was no
// durable record of WHICH sources silently degraded to the lexical fallback.
// These two tables make the pipeline observable and self-healing:
//
// - kb_topic_index_runs: one row per "Build Topic Index" run — live progress
//   counters, the llm/lexical/none/failed outcome split, per-source failure
//   reasons, exact-duplicate source flags, and an optional model-quality
//   spot-check report. Survives restarts; exposed on the status endpoint.
// - kb_topic_index_source_state: the last classification OUTCOME per source
//   document. This is what distinguishes a deliberate LLM "no nodes fit"
//   verdict ('llm_none', respected on re-runs) from a degraded lexical
//   fallback ('lexical'/'failed', re-attempted on the next force=false run).

/** Per-source failure entry recorded on a run (reason a source degraded). */
export interface TopicIndexRunFailure {
  sourceDocId: number;
  title: string;
  reason: string;
}

/** A group of byte-identical source documents flagged for operator cleanup. */
export interface TopicIndexDuplicateGroup {
  ids: number[];
  titles: string[];
}

/** Model-quality spot-check report (new model vs stored gpt-5 links). */
export interface TopicIndexQualityCheck {
  ranAt: string;
  model: string;
  sampleSize: number;
  /** Mean per-source Jaccard agreement (0..1) on chosen node sets. */
  nodeAgreement: number;
  /** Mean relevance delta (new - stored) over agreeing nodes. */
  meanRelevanceDelta: number;
  perSource: Array<{
    sourceDocId: number;
    title: string;
    storedNodes: string[];
    newNodes: string[];
    agreement: number;
    relevanceDelta: number | null;
    error?: string;
  }>;
}

export const kbTopicIndexRunsTable = pgTable("kb_topic_index_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  force: boolean("force").notNull().default(false),
  total: integer("total").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  // Outcome split across processed sources.
  llmCount: integer("llm_count").notNull().default(0),
  llmNoneCount: integer("llm_none_count").notNull().default(0),
  lexicalCount: integer("lexical_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  excludedCount: integer("excluded_count").notNull().default(0),
  linkedCount: integer("linked_count").notNull().default(0),
  // Fatal run-level error (per-source failures live in `failures`).
  error: text("error"),
  // Per-source failure reasons (durable — survives restarts).
  failures: jsonb("failures").$type<TopicIndexRunFailure[]>().notNull().default(sql`'[]'::jsonb`),
  // Byte-identical duplicate source groups flagged (never auto-deleted).
  duplicateFlags: jsonb("duplicate_flags").$type<TopicIndexDuplicateGroup[]>().notNull().default(sql`'[]'::jsonb`),
  // Optional model-quality spot-check attached to this run.
  qualityCheck: jsonb("quality_check").$type<TopicIndexQualityCheck | null>().default(null),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("kb_topic_index_runs_started_idx").on(table.startedAt),
]);

/**
 * Last classification outcome per source document:
 * - 'llm':      LLM classified it into >=1 node (healthy).
 * - 'llm_none': LLM deliberately said no nodes fit — respected, NOT retried.
 * - 'lexical':  LLM failed after retries; lexical fallback links stored. Retried
 *               on the next force=false run.
 * - 'failed':   LLM failed AND lexical produced nothing. Retried next run.
 * - 'excluded': screened duplicate call — contributes nothing by design.
 */
export const kbTopicIndexSourceStateTable = pgTable("kb_topic_index_source_state", {
  sourceDocId: integer("source_doc_id")
    .primaryKey()
    .references(() => aiSourceDocumentsTable.id, { onDelete: "cascade" }),
  outcome: text("outcome").notNull(),
  error: text("error"),
  runId: integer("run_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("kb_topic_index_source_state_outcome_idx").on(table.outcome),
]);

export type KbTopicIndexRun = typeof kbTopicIndexRunsTable.$inferSelect;
export type KbTopicIndexSourceState = typeof kbTopicIndexSourceStateTable.$inferSelect;
