import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { kbCallScreeningsTable } from "./kb-call-screenings";
import { aiSourceDocumentsTable } from "./ai-source-documents";

/**
 * The durable SCREENED-OUTPUT store for the coaching-transcript value screener
 * (Task #1702, refined #1707). One row per topic-threaded SEGMENT (the member
 * prompt/context + the coach teaching for one topic) within a screened source.
 *
 * Deliberately stores KEPT **and** DROPPED units (nothing is discarded): the
 * `disposition` column records the verdict and `dropReason` records WHY a unit
 * was dropped, so the whole screening is auditable and reversible. The later
 * topic-index/extract phase reads only the rows whose EFFECTIVE disposition is
 * 'keep' (see effectiveDisposition — an admin overrule wins over the AI verdict).
 *
 * `valueType` and `disposition` are plain `text` closed vocabularies owned by
 * the api-server kb-value-screener module (VALUE_TYPES / DISPOSITIONS), not pg
 * enums, consistent with the rest of the KB schema.
 *
 * Rows cascade-delete with their screening (and therefore with their source).
 */
export const kbScreenedExchangesTable = pgTable("kb_screened_exchanges", {
  id: serial("id").primaryKey(),
  // The screening run this exchange belongs to.
  screeningId: integer("screening_id")
    .notNull()
    .references(() => kbCallScreeningsTable.id, { onDelete: "cascade" }),
  // Denormalized source doc id (convenience for topic-index reads / filtering).
  sourceDocId: integer("source_doc_id")
    .notNull()
    .references(() => aiSourceDocumentsTable.id, { onDelete: "cascade" }),
  // 0-based position of this exchange within the source (stable ordering).
  orderIndex: integer("order_index").notNull(),
  // ONE role-labeled transcript passage (inline "Coach:"/"Member:" speaker
  // labels preserved). This replaced the old memberPrompt/coachResponse split,
  // which misrepresented topic-threaded segments (coach speech routinely landed
  // in memberPrompt and vice versa). The legacy member_prompt/coach_response
  // columns still exist in the DB (defaults '') but are no longer written.
  passage: text("passage").notNull().default(""),
  // The member question that prompted this teaching (anchor context), when one
  // exists — kept separate so retrieval/synthesis can anchor an answer to its
  // question even when the question turn was folded in from a prior segment.
  anchorQuestion: text("anchor_question"),
  // TRUE for keeps that are live screen-share walkthrough narration ("click the
  // edit button…") — topic evidence but not standalone quotable teaching; the
  // downstream synthesis/extract phase down-weights these.
  contextBound: boolean("context_bound").notNull().default(false),
  // LLM value-type classification (e.g. principle, framework, worked_example,
  // troubleshooting, chitchat, logistics, situational_answer). Plain text.
  valueType: text("value_type").notNull().default("unclassified"),
  // Disposition: 'keep' | 'drop' | 'flag' verdicts, plus 'error' (a reliability
  // status meaning classification failed after retries — NOT a real verdict).
  disposition: text("disposition").notNull().default("flag"),
  // Why a unit was dropped/flagged/errored (audit trail; NULL for clean keeps).
  dropReason: text("drop_reason"),
  // TRUE when the answer is anchored to THIS member's specific numbers/situation
  // (spend, ROI, account state) OR is time-sensitive, and so is context-bound
  // rather than a general lesson. Such units are KEPT with their context.
  situationalNumber: boolean("situational_number").notNull().default(false),
  // Short model rationale for the disposition (preview transparency).
  rationale: text("rationale"),
  // TRUE when this segment was closed by the segmenter's EMERGENCY size
  // ceiling (or overran it) rather than a normal topic boundary — a
  // pathological-input audit anomaly (Task #1742), surfaced to the admin.
  emergencySplit: boolean("emergency_split").notNull().default(false),
  // Admin overrule. NULL = no overrule; the AI disposition stands. When set, it
  // wins over `disposition` for downstream reads.
  overrideDisposition: text("override_disposition"),
  overrideBy: integer("override_by"),
  overrideAt: timestamp("override_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("kb_screened_exchanges_screening_idx").on(table.screeningId),
  index("kb_screened_exchanges_source_idx").on(table.sourceDocId),
  index("kb_screened_exchanges_disposition_idx").on(table.disposition),
]);

export const insertKbScreenedExchangeSchema = createInsertSchema(kbScreenedExchangesTable).omit({ id: true, createdAt: true });
export type InsertKbScreenedExchange = z.infer<typeof insertKbScreenedExchangeSchema>;
export type KbScreenedExchange = typeof kbScreenedExchangesTable.$inferSelect;
