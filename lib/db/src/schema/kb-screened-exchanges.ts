import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { kbCallScreeningsTable } from "./kb-call-screenings";
import { aiSourceDocumentsTable } from "./ai-source-documents";

/**
 * The durable SCREENED-OUTPUT store for the coaching-transcript value screener
 * (Task #1702). One row per segmented EXCHANGE (a member prompt + the coach
 * response to it) within a screened source.
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
  // The member's question/prompt text (may be empty for a coach-only aside).
  memberPrompt: text("member_prompt").notNull().default(""),
  // The coach's response text — the substance that carries teaching value.
  coachResponse: text("coach_response").notNull().default(""),
  // LLM value-type classification (e.g. principle, framework, worked_example,
  // troubleshooting, chitchat, logistics, situational_answer). Plain text.
  valueType: text("value_type").notNull().default("unclassified"),
  // AI disposition: 'keep' | 'drop' | 'flag'.
  disposition: text("disposition").notNull().default("flag"),
  // Why a unit was dropped/flagged (audit trail; NULL for clean keeps).
  dropReason: text("drop_reason"),
  // TRUE when the answer is anchored to THIS member's specific numbers/situation
  // (spend, ROI, account state) and so is context-bound, not a general lesson.
  situationalNumber: boolean("situational_number").notNull().default(false),
  // Short model rationale for the disposition (preview transparency).
  rationale: text("rationale"),
  // Admin overrule (feeds calibration). NULL = no overrule; the AI disposition
  // stands. When set, it wins over `disposition` for downstream reads.
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
