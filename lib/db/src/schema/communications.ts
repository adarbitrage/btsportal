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
export type SmsTemplate = typeof smsTemplatesTable.$inferSelect;
export type CommunicationLog = typeof communicationLogTable.$inferSelect;
export type EmailUnsubscribe = typeof emailUnsubscribesTable.$inferSelect;
export type EmailBounce = typeof emailBouncesTable.$inferSelect;
