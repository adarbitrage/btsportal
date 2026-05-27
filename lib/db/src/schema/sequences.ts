import { pgTable, text, serial, integer, boolean, timestamp, jsonb, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const sequencesTable = pgTable("sequences", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  triggerEvent: text("trigger_event").notNull(),
  productType: text("product_type"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const sequenceStepsTable = pgTable(
  "sequence_steps",
  {
    id: serial("id").primaryKey(),
    sequenceId: integer("sequence_id").notNull().references(() => sequencesTable.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull(),
    channel: text("channel").notNull().default("email"),
    templateRef: text("template_ref").notNull(),
    subject: text("subject"),
    delayMinutes: integer("delay_minutes").notNull().default(0),
    conditions: jsonb("conditions").$type<{
      ifNotCompleted?: string;
      ifNotLoggedIn?: boolean;
      ifProductLevel?: string[];
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Mirrors the raw-SQL index created in 0003_ordinary_namorita.sql so
    // `drizzle-kit push` produces the same constraint set as running all
    // migrations. Backs the per-sequence lookup of ordered steps used by
    // the sequence engine.
    index("sequence_steps_sequence_id_idx").on(table.sequenceId),
  ],
);

export const sequenceEnrollmentsTable = pgTable(
  "sequence_enrollments",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id),
    sequenceId: integer("sequence_id").notNull().references(() => sequencesTable.id),
    status: text("status").notNull().default("active"),
    currentStepOrder: integer("current_step_order").notNull().default(0),
    // Mirror the FK added in 0003_ordinary_namorita.sql so `drizzle-kit push`
    // produces the same constraint set as running all migrations. The column
    // is not yet read by the sequence engine (which tracks position via
    // `current_step_order`), but production carries it so the schema must too.
    currentStepId: integer("current_step_id").references((): AnyPgColumn => sequenceStepsTable.id),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    lastProcessedAt: timestamp("last_processed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [
    // Mirror the raw-SQL indexes created in 0003_ordinary_namorita.sql so
    // `drizzle-kit push` produces the same constraint set as running all
    // migrations. Back the per-sequence / per-user / per-status lookups
    // used by the sequence engine and admin views.
    index("sequence_enrollments_sequence_id_idx").on(table.sequenceId),
    index("sequence_enrollments_user_id_idx").on(table.userId),
    index("sequence_enrollments_status_idx").on(table.status),
  ],
);

export const insertSequenceSchema = createInsertSchema(sequencesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSequence = z.infer<typeof insertSequenceSchema>;
export type Sequence = typeof sequencesTable.$inferSelect;

export const insertSequenceStepSchema = createInsertSchema(sequenceStepsTable).omit({ id: true, createdAt: true });
export type InsertSequenceStep = z.infer<typeof insertSequenceStepSchema>;
export type SequenceStep = typeof sequenceStepsTable.$inferSelect;

export const insertSequenceEnrollmentSchema = createInsertSchema(sequenceEnrollmentsTable).omit({ id: true });
export type InsertSequenceEnrollment = z.infer<typeof insertSequenceEnrollmentSchema>;
export type SequenceEnrollment = typeof sequenceEnrollmentsTable.$inferSelect;
