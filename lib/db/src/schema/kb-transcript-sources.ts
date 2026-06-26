import { pgTable, text, serial, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Registry of transcript SOURCES (a recording / batch-uploaded file / coaching
 * call) behind the training corpus. One row per logical source.
 *
 * Two orthogonal axes, both deliberately plain `text` (vocabulary owned by the
 * api-server kb-taxonomy registry, not pg enums):
 *
 *  - disposition: 'training' | 'quarantined'. Quarantined sources (internal
 *    meetings, coach check-ins, personal rooms, team syncs, founder meetings,
 *    untitled/unidentifiable recordings) are excluded from member answers AND
 *    from the mining/authoring pipeline. Conservative default: 'quarantined'
 *    until a human (Task #2) clears it.
 *
 *  - authorityRole: mirrors `coaches.type` — 'strategic_coach' | 'va' plus
 *    'curriculum' (official training videos) | 'internal' (quarantined). Role
 *    is resolved by joining the source's coach/VA name to the live `coaches`
 *    roster (name → type), never a hard-coded name list. VAs are authoritative
 *    for software/tools/basic setup but NOT for strategy claims. Conservative
 *    default: 'internal'.
 *
 * Population (source screening + the known-internal seed list + the name→role
 * resolution sweep) lives in Task #2; this table + its conservative defaults
 * are the foundation.
 */
export const kbTranscriptSourcesTable = pgTable("kb_transcript_sources", {
  id: serial("id").primaryKey(),
  // Stable identifier of the source (recording title / file path / call name).
  sourceName: text("source_name").notNull(),
  // Coarse kind: 'coaching_call' | 'video' | 'va_docx' | 'meeting' | 'unknown'.
  sourceKind: text("source_kind").notNull().default("unknown"),
  // Resolved coach/VA display name (joined to `coaches`), when identifiable.
  coachName: text("coach_name"),
  disposition: text("disposition").notNull().default("quarantined"),
  authorityRole: text("authority_role").notNull().default("internal"),
  // Free-form note explaining the disposition/role decision (audit trail).
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("kb_transcript_sources_name_uniq").on(table.sourceName),
  index("kb_transcript_sources_disposition_idx").on(table.disposition),
  index("kb_transcript_sources_role_idx").on(table.authorityRole),
]);

export const insertKbTranscriptSourceSchema = createInsertSchema(kbTranscriptSourcesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKbTranscriptSource = z.infer<typeof insertKbTranscriptSourceSchema>;
export type KbTranscriptSource = typeof kbTranscriptSourcesTable.$inferSelect;
