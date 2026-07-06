import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * The versioned COACH CALIBRATION set for the value screener (Task #1702).
 *
 * Coaches (or admins) mark exemplar exchanges as GOLD (high-value teaching the
 * screener should keep) or NOISE (chitchat/logistics/situational answers the
 * screener should drop). These exemplars are injected as FEW-SHOT examples into
 * the LLM value-type classifier so its judgement is tuned to what this team
 * actually considers valuable — the screener works COLD (no examples) with a
 * default rubric, and gets sharper as the calibration set grows.
 *
 * "Versioned": the screener does not store a monotonically-incrementing counter
 * here. Instead the calibration VERSION is a deterministic fingerprint of the
 * currently-active exemplar set (see computeCalibrationVersion), stamped onto
 * each kb_call_screenings row. Adding/removing/toggling an exemplar changes the
 * fingerprint, which marks prior screenings stale so they are re-run against the
 * new calibration. This keeps the "version" honest without a separate counter.
 *
 * `label` is plain text ('gold' | 'noise'). Examples can be authored directly
 * OR captured from an admin overrule in the pilot screen (the overruled
 * exchange's text + the corrected verdict), recorded via `sourceExchangeId`.
 */
export const kbCalibrationExamplesTable = pgTable("kb_calibration_examples", {
  id: serial("id").primaryKey(),
  // The member prompt of the exemplar exchange (optional context).
  memberPrompt: text("member_prompt").notNull().default(""),
  // The coach response — the substance the label is a judgement about.
  coachResponse: text("coach_response").notNull().default(""),
  // 'gold' (keep-worthy exemplar) | 'noise' (drop-worthy exemplar).
  label: text("label").notNull(),
  // Optional value-type tag for a gold exemplar (mirrors VALUE_TYPES).
  valueType: text("value_type"),
  // Optional human note explaining the judgement (not sent to the LLM).
  note: text("note"),
  // Provenance: when captured from a pilot-screen overrule, the screened
  // exchange id it came from (soft link, no hard FK — exchanges are ephemeral
  // per re-run). NULL for hand-authored exemplars.
  sourceExchangeId: integer("source_exchange_id"),
  // Admin user id that authored/captured the exemplar.
  createdBy: integer("created_by"),
  // Soft-disable an exemplar without deleting it (excluded from the active set
  // and from the calibration version). Default active.
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("kb_calibration_examples_label_idx").on(table.label),
  index("kb_calibration_examples_active_idx").on(table.active),
]);

export const insertKbCalibrationExampleSchema = createInsertSchema(kbCalibrationExamplesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKbCalibrationExample = z.infer<typeof insertKbCalibrationExampleSchema>;
export type KbCalibrationExample = typeof kbCalibrationExamplesTable.$inferSelect;
