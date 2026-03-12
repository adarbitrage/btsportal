import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
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

export const sequenceStepsTable = pgTable("sequence_steps", {
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
});

export const sequenceEnrollmentsTable = pgTable("sequence_enrollments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  sequenceId: integer("sequence_id").notNull().references(() => sequencesTable.id),
  status: text("status").notNull().default("active"),
  currentStepOrder: integer("current_step_order").notNull().default(0),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  lastProcessedAt: timestamp("last_processed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

export const insertSequenceSchema = createInsertSchema(sequencesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSequence = z.infer<typeof insertSequenceSchema>;
export type Sequence = typeof sequencesTable.$inferSelect;

export const insertSequenceStepSchema = createInsertSchema(sequenceStepsTable).omit({ id: true, createdAt: true });
export type InsertSequenceStep = z.infer<typeof insertSequenceStepSchema>;
export type SequenceStep = typeof sequenceStepsTable.$inferSelect;

export const insertSequenceEnrollmentSchema = createInsertSchema(sequenceEnrollmentsTable).omit({ id: true });
export type InsertSequenceEnrollment = z.infer<typeof insertSequenceEnrollmentSchema>;
export type SequenceEnrollment = typeof sequenceEnrollmentsTable.$inferSelect;
