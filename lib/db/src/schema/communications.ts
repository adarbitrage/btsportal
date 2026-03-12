import { pgTable, text, serial, integer, boolean, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const emailTemplatesTable = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body").notNull(),
  category: text("category").notNull().default("transactional"),
  fromName: text("from_name"),
  variables: jsonb("variables").$type<string[]>().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const emailTemplateVersionsTable = pgTable("email_template_versions", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => emailTemplatesTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body").notNull(),
  category: text("category").notNull(),
  fromName: text("from_name"),
  variables: jsonb("variables").$type<string[]>().default([]),
  savedBy: integer("saved_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("email_template_versions_template_id_idx").on(table.templateId),
]);

export const smsTemplatesTable = pgTable("sms_templates", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  variables: jsonb("variables").$type<string[]>().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const sequencesTable = pgTable("sequences", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  triggerEvent: text("trigger_event"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const sequenceStepsTable = pgTable("sequence_steps", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").notNull().references(() => sequencesTable.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  channel: text("channel").notNull().default("email"),
  templateSlug: text("template_slug"),
  subject: text("subject"),
  body: text("body"),
  delayMinutes: integer("delay_minutes").notNull().default(0),
  condition: jsonb("condition").$type<Record<string, unknown>>(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("sequence_steps_sequence_id_idx").on(table.sequenceId),
]);

export const sequenceEnrollmentsTable = pgTable("sequence_enrollments", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").notNull().references(() => sequencesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  currentStepId: integer("current_step_id").references(() => sequenceStepsTable.id),
  status: text("status").notNull().default("active"),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  lastStepAt: timestamp("last_step_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
}, (table) => [
  index("sequence_enrollments_sequence_id_idx").on(table.sequenceId),
  index("sequence_enrollments_user_id_idx").on(table.userId),
  index("sequence_enrollments_status_idx").on(table.status),
]);

export const broadcastsTable = pgTable("broadcasts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  channel: text("channel").notNull().default("email"),
  templateId: integer("template_id"),
  subject: text("subject"),
  htmlBody: text("html_body"),
  textBody: text("text_body"),
  smsBody: text("sms_body"),
  segmentFilter: jsonb("segment_filter").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  totalRecipients: integer("total_recipients").default(0),
  sentCount: integer("sent_count").default(0),
  deliveredCount: integer("delivered_count").default(0),
  openedCount: integer("opened_count").default(0),
  clickedCount: integer("clicked_count").default(0),
  bouncedCount: integer("bounced_count").default(0),
  failedCount: integer("failed_count").default(0),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("broadcasts_status_idx").on(table.status),
  index("broadcasts_created_at_idx").on(table.createdAt),
]);

export const communicationLogTable = pgTable("communication_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  channel: text("channel").notNull(),
  templateSlug: text("template_slug"),
  recipientEmail: text("recipient_email"),
  recipientPhone: text("recipient_phone"),
  subject: text("subject"),
  fromEmail: text("from_email"),
  status: text("status").notNull().default("queued"),
  sendgridMessageId: text("sendgrid_message_id"),
  twilioMessageSid: text("twilio_message_sid"),
  category: text("category"),
  broadcastId: integer("broadcast_id").references(() => broadcastsTable.id),
  sequenceId: integer("sequence_id").references(() => sequencesTable.id),
  renderedHtml: text("rendered_html"),
  renderedText: text("rendered_text"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  clickedAt: timestamp("clicked_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  bouncedAt: timestamp("bounced_at", { withTimezone: true }),
  bounceType: text("bounce_type"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("communication_log_user_id_idx").on(table.userId),
  index("communication_log_status_idx").on(table.status),
  index("communication_log_sendgrid_msg_idx").on(table.sendgridMessageId),
  index("communication_log_twilio_sid_idx").on(table.twilioMessageSid),
  index("communication_log_channel_idx").on(table.channel),
  index("communication_log_created_at_idx").on(table.createdAt),
  index("communication_log_broadcast_id_idx").on(table.broadcastId),
  index("communication_log_sequence_id_idx").on(table.sequenceId),
]);

export const emailUnsubscribesTable = pgTable("email_unsubscribes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  email: text("email").notNull(),
  reason: text("reason"),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }).notNull().defaultNow(),
  resubscribedAt: timestamp("resubscribed_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("email_unsubscribes_email_idx").on(table.email),
  index("email_unsubscribes_user_id_idx").on(table.userId),
]);

export const emailBouncesTable = pgTable("email_bounces", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  bounceType: text("bounce_type").notNull(),
  reason: text("reason"),
  suppressed: boolean("suppressed").notNull().default(false),
  bouncedAt: timestamp("bounced_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("email_bounces_email_idx").on(table.email),
  index("email_bounces_suppressed_idx").on(table.suppressed),
]);

export type EmailTemplate = typeof emailTemplatesTable.$inferSelect;
export type EmailTemplateVersion = typeof emailTemplateVersionsTable.$inferSelect;
export type SmsTemplate = typeof smsTemplatesTable.$inferSelect;
export type CommunicationLog = typeof communicationLogTable.$inferSelect;
export type EmailUnsubscribe = typeof emailUnsubscribesTable.$inferSelect;
export type EmailBounce = typeof emailBouncesTable.$inferSelect;
export type Sequence = typeof sequencesTable.$inferSelect;
export type SequenceStep = typeof sequenceStepsTable.$inferSelect;
export type SequenceEnrollment = typeof sequenceEnrollmentsTable.$inferSelect;
export type Broadcast = typeof broadcastsTable.$inferSelect;
