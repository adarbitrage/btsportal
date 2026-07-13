import { pgTable, text, serial, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { kbStagingDocsTable } from "./kb-staging";

/**
 * KB review flag lifecycle (Task #1906).
 *
 * Two persistence surfaces so reviewer decisions survive re-analysis and
 * re-synthesis instead of resurrecting on every run:
 *
 * 1. kb_highlight_dismissals — passage-level "Ignore" for review-insight
 *    highlights (kb-review-risk). Keyed on (kind + normalized excerpt), NOT the
 *    staging-doc row id, so a dismissal carries over when a future synthesis
 *    run reproduces the identical passage in a fresh draft. stagingDocId is
 *    audit context only (where it was first dismissed).
 *
 * 2. kb_flag_resolutions — doc-level Resolve/Ignore for stored risk flags
 *    (kb-flags). One resolution per (doc, flagType); the fingerprint pins the
 *    resolution to the flag's trigger (message+detail), so a deterministic
 *    re-triage that reproduces the SAME flag stays resolved, while a flag with
 *    a NEW trigger resurfaces for fresh adjudication.
 */
export const kbHighlightDismissalsTable = pgTable(
  "kb_highlight_dismissals",
  {
    id: serial("id").primaryKey(),
    // ReviewHighlightKind (kb-review-risk) — validated at the route.
    kind: text("kind").notNull(),
    // Lowercased, whitespace-collapsed excerpt — the cross-doc suppression key.
    excerptNorm: text("excerpt_norm").notNull(),
    // Original excerpt as flagged, for display in the dismissed list.
    displayExcerpt: text("display_excerpt").notNull(),
    // Where the dismissal was made (audit context only — the key is global).
    stagingDocId: integer("staging_doc_id").references(() => kbStagingDocsTable.id, { onDelete: "set null" }),
    dismissedBy: integer("dismissed_by").references(() => usersTable.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("kb_highlight_dismissals_kind_excerpt_unique").on(table.kind, table.excerptNorm)],
);

export type KbHighlightDismissal = typeof kbHighlightDismissalsTable.$inferSelect;

export const kbFlagResolutionsTable = pgTable(
  "kb_flag_resolutions",
  {
    id: serial("id").primaryKey(),
    stagingDocId: integer("staging_doc_id")
      .notNull()
      .references(() => kbStagingDocsTable.id, { onDelete: "cascade" }),
    // RiskFlagType (kb-flags) — validated at the route.
    flagType: text("flag_type").notNull(),
    // Normalized message+detail of the flag AS RESOLVED. A recomputed flag of
    // the same type with a different fingerprint is a NEW trigger and is NOT
    // covered by this resolution.
    fingerprint: text("fingerprint").notNull(),
    resolvedBy: integer("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("kb_flag_resolutions_doc_type_unique").on(table.stagingDocId, table.flagType)],
);

export type KbFlagResolution = typeof kbFlagResolutionsTable.$inferSelect;
