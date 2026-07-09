import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Reviewer-dismissed "possible member name" pairs (Task #1815).
 *
 * The review-panel possible_member_name advisory heuristic (api-server
 * kb-review-risk) suppresses false positives via EXACT capitalized-pair
 * allowlists. This table is the persistent, admin-managed half of that
 * vocabulary: when a reviewer clicks "Not a name" on a flag chip, the exact
 * pair is stored here and excluded analyzer-wide, forever, on every doc.
 * Rows are visible in the admin panel and deletable (undo).
 *
 * Safety rail: a pair matching the privacy-rule staff surnames can never be
 * suppressed — enforced at insert time (route) AND at analyzer time.
 */
export const kbNameFlagDismissalsTable = pgTable("kb_name_flag_dismissals", {
  id: serial("id").primaryKey(),
  // Lowercased "first last" pair — the exact-match suppression key.
  pair: text("pair").notNull().unique(),
  // Original casing as flagged, for display in the admin list.
  displayPair: text("display_pair").notNull(),
  dismissedBy: integer("dismissed_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KbNameFlagDismissal = typeof kbNameFlagDismissalsTable.$inferSelect;
