import { pgTable, text, serial, integer, real, jsonb, timestamp, index, unique } from "drizzle-orm/pg-core";

// Content-Gap Radar (demand-side): one row per distinct unanswered/low-confidence
// question the AI assistants (chat or voice) could not confidently answer.
//
// Captured at the "no confident match" point in retrieval so authoring is driven
// by real demand instead of guesswork. Repeats are grouped/counted via the
// (surface, normalized_question) unique key — each new occurrence increments
// ask_count and refreshes last_asked_at + the latest context, so the most-asked
// gaps rise to the top of the admin list.
//
// All free text (question_text, near_misses titles) is privacy-scrubbed BEFORE
// it is written here — the radar never stores raw PII.
export const contentGapQuestionsTable = pgTable(
  "content_gap_questions",
  {
    id: serial("id").primaryKey(),
    // Which assistant surface hit the gap: 'chat' | 'voice'.
    surface: text("surface").notNull(),
    // Lowercased / whitespace-collapsed / punctuation-trimmed question, used
    // solely as the grouping key so near-identical repeats collapse into one row.
    normalizedQuestion: text("normalized_question").notNull(),
    // The latest (privacy-scrubbed) question text as asked, for display.
    questionText: text("question_text").notNull(),
    // Top precise-match ts_rank at the time of the most recent miss (0 when only
    // the loose word-OR fallback matched). A coarse "how close were we" signal.
    topScore: real("top_score").notNull().default(0),
    // Top query↔doc embedding cosine similarity at the most recent miss (0 when
    // the semantic layer was unavailable). Together with top_score this records
    // BOTH retrieval signals for every miss (Task #1803).
    topSemanticScore: real("top_semantic_score").notNull().default(0),
    // The nearest non-confident matches at the most recent miss: the docs the
    // retriever surfaced but that did not clear the confidence bar. Titles are
    // privacy-scrubbed. Helps an author see what the corpus *almost* answered.
    nearMisses: jsonb("near_misses")
      .$type<{ id: number; title: string; score: number }[]>()
      .notNull()
      .default([]),
    // How many times this gap has been hit (grouped repeats).
    askCount: integer("ask_count").notNull().default(1),
    firstAskedAt: timestamp("first_asked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAskedAt: timestamp("last_asked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    // Grouping key: one row per distinct question per surface.
    surfaceQuestionUnique: unique("content_gap_questions_surface_question_unique").on(
      table.surface,
      table.normalizedQuestion,
    ),
    // List sorts: by frequency (ask_count) and by recency (last_asked_at).
    askCountIdx: index("content_gap_questions_ask_count_idx").on(table.askCount),
    lastAskedIdx: index("content_gap_questions_last_asked_idx").on(table.lastAskedAt),
  }),
);

export type ContentGapQuestion = typeof contentGapQuestionsTable.$inferSelect;
export type InsertContentGapQuestion = typeof contentGapQuestionsTable.$inferInsert;
