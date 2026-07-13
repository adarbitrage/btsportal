import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Corpus sweep runs (Task #1903). A reviewer-facing tool for cross-document
 * corrections: when incorrect terminology or a flawed concept may span multiple
 * docs, a sweep finds every affected staging draft / live doc and (after the
 * reviewer confirms) appends a proposed-correction NOTE to each — staging →
 * admin_notes, live → reviewer_notes, append-only. No document body is ever
 * modified by a sweep.
 *
 * Phrase mode is a synchronous two-phase preview/confirm (instant DB search) and
 * doesn't need a run row. Concept mode makes one bounded LLM call per candidate
 * doc, so it runs as a BACKGROUND job whose progress + per-doc verdicts persist
 * here — a run can never be lost to a browser/proxy connection timeout.
 */

/** Per-candidate outcome of a concept sweep. */
export interface CorpusSweepResult {
  kind: "staging" | "live";
  id: number;
  title: string;
  /** 'yes' = contains the flawed concept; 'no' = clean; 'error' = the LLM judgment failed (loud, never coerced to 'no'). */
  verdict: "yes" | "no" | "error";
  /** Exact quote from the doc evidencing the flawed concept (verdict 'yes'). */
  evidence?: string;
  /** Draft per-doc correction note (verdict 'yes'). */
  proposedCorrection?: string;
  /** Failure detail (verdict 'error'). */
  error?: string;
  /** True once the confirm step wrote the note onto this doc. */
  noted?: boolean;
}

export const kbCorpusSweepRunsTable = pgTable("kb_corpus_sweep_runs", {
  id: serial("id").primaryKey(),
  // 'concept' today; 'phrase' reserved should phrase runs ever need durability.
  mode: text("mode").notNull().default("concept"),
  // running | ready (awaiting reviewer confirm) | confirmed | failed
  status: text("status").notNull().default("running"),
  // The reviewer's plain-language description of the flawed vs correct concept.
  incorrectConcept: text("incorrect_concept").notNull(),
  correctConcept: text("correct_concept").notNull(),
  total: integer("total").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  results: jsonb("results").$type<CorpusSweepResult[]>().notNull().default(sql`'[]'::jsonb`),
  // Fatal run-level error (per-doc failures live inside `results`).
  error: text("error"),
  createdBy: integer("created_by"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  notesWrittenAt: timestamp("notes_written_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("kb_corpus_sweep_runs_started_idx").on(table.startedAt),
]);

export type KbCorpusSweepRun = typeof kbCorpusSweepRunsTable.$inferSelect;
