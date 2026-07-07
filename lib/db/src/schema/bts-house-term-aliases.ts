import { pgTable, text, serial, boolean, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Admin-manageable BTS house-term auto-correct overrides (Task #1676).
 *
 * The Transcript Cleaner deterministically auto-corrects near-miss spellings of
 * BTS's proprietary tools (DIYTrax, MetricMover, Flexy, PixelPress, …) via a
 * code-defined alias map (`BTS_TERM_ALIASES`) plus a conservative fuzzy pass.
 * That map is "self-healing" but historically required a code change per new
 * misspelling. This table lets an admin/editor add a confirmed
 * misspelling → canonical pair with NO deploy: it is merged with the code
 * baseline into the EFFECTIVE alias map read at clean/refine time.
 *
 * Only ADDITIONS live here — the shipped baseline stays authoritative in code
 * and is never duplicated into the DB. A DB row with the same key overrides the
 * baseline; a disabled row drops out of the effective map (baseline still wins).
 */
export const btsHouseTermAliasesTable = pgTable("bts_house_term_aliases", {
  id: serial("id").primaryKey(),
  // The misspelling to match — stored lowercased. Matched whole-word /
  // whole-phrase, case-insensitively, exactly like the code alias map.
  misspelling: text("misspelling").notNull().unique(),
  // The canonical replacement, written verbatim (correct casing).
  canonical: text("canonical").notNull(),
  // Disabled rows are preserved for history but drop out of the effective map.
  enabled: boolean("enabled").notNull().default(true),
  // Provenance: 'admin' (hand-added) | 'review_approved' (promoted from the
  // "slipped through recent transcripts" review surface).
  source: text("source").notNull().default("admin"),
  // Optional reviewer context (e.g. the transcript title it was spotted in).
  note: text("note"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("bts_house_term_aliases_enabled_idx").on(table.enabled),
]);

export type BtsHouseTermAlias = typeof btsHouseTermAliasesTable.$inferSelect;
export type InsertBtsHouseTermAlias = typeof btsHouseTermAliasesTable.$inferInsert;
