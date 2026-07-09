import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * AI-proposes / human-approves synonym-gap queue (Task #1804).
 *
 * The retrieval synonym/alias layer (api-server voice-synonyms.ts) is CODE — a
 * versioned, unit-tested map of member phrasings → canonical KB lexemes. When
 * the per-doc AI analysis notices a member phrasing for a doc's topic that the
 * alias map does NOT cover, it records (or increments) a proposal here,
 * mirroring the kb_proposed_tool_tags pattern. A human reviews the queue;
 * approval marks the row as accepted for a developer to fold into the code
 * alias map — the AI never changes live retrieval on its own.
 */
export const kbProposedSynonymsTable = pgTable("kb_proposed_synonyms", {
  id: serial("id").primaryKey(),
  // Normalized member phrasing (lowercase, single-spaced) — the dedup key.
  memberPhrase: text("member_phrase").notNull().unique(),
  // Canonical KB lexeme(s) the phrasing should expand to (space-separated
  // single-word to_tsquery-safe tokens, e.g. "refund" or "testing scaling").
  canonicalTerm: text("canonical_term").notNull(),
  // 'pending' | 'approved' | 'rejected'.
  status: text("status").notNull().default("pending"),
  // How many analyzed docs surfaced this same uncovered phrasing.
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  // An example staging-doc title where the gap was observed (reviewer context).
  exampleContext: text("example_context"),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("kb_proposed_synonyms_status_idx").on(table.status),
]);

export type KbProposedSynonym = typeof kbProposedSynonymsTable.$inferSelect;
export type InsertKbProposedSynonym = typeof kbProposedSynonymsTable.$inferInsert;
