import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const ticketsTable = pgTable("tickets", {
  id: serial("id").primaryKey(),
  ticketNumber: text("ticket_number").notNull().unique(),
  userId: integer("user_id").references(() => usersTable.id),
  category: text("category").notNull().default("other"),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("open"),
  subject: text("subject").notNull(),
  // Stable identifier for the surface that opened this ticket. Set when the
  // ticket originated from an in-app entry point that the support team wants
  // to filter / prioritise as a group — currently the cancelled-email banner
  // on the member account page (value: "email_admin_cancelled_banner").
  // Null for ad-hoc tickets opened from the generic support form. Kept as
  // free-form text (not an enum) so adding a new entry point in the future
  // doesn't require a schema migration.
  source: text("source"),
  // Optional foreign key into the originating record so admins can jump from
  // the ticket back to the row that triggered it. For the cancelled-email
  // banner source this is the `email_change_attempts.id` of the cancelled
  // attempt. Stored as a plain int (not a FK constraint) because the source
  // table varies by `source` value — the ticket still makes sense if the
  // upstream row is later deleted.
  sourceReferenceId: integer("source_reference_id"),
  assignedTo: integer("assigned_to").references(() => usersTable.id),
  // TicketDesk delivery pipeline status — tracks whether the ticket reached the
  // external support platform. Values: 'pending' (not yet attempted), 'delivered'
  // (successfully mirrored to TicketDesk), 'skipped' (no API key configured),
  // 'failed' (all retries exhausted). All three non-pending outcomes trigger a
  // fallback email to the support inbox so no member request is ever lost.
  deliveryStatus: text("delivery_status").notNull().default("pending"),
  deliveryLastAttemptAt: timestamp("delivery_last_attempt_at", { withTimezone: true }),
  deliveryLastError: text("delivery_last_error"),
  // True when the last message in the conversation is agent-authored and the
  // ticket is not resolved — i.e. the ball is (softly) in the member's court.
  // Set by the TicketDesk poller / inbound-reply paths when an agent reply is
  // appended, and cleared IMMEDIATELY when the member replies (both directly
  // in the reply endpoints, without waiting for the next poll cycle). This is
  // an inference, not a hard workflow state: the member-facing UI renders it
  // as a soft "New reply — response may be needed" indicator, never a loud
  // "action required" gate.
  awaitingMemberReply: boolean("awaiting_member_reply").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({ id: true, ticketNumber: true, createdAt: true, updatedAt: true, resolvedAt: true });
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;

export const ticketMessagesTable = pgTable("ticket_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id),
  senderType: text("sender_type").notNull().default("member"),
  body: text("body").notNull(),
  isInternal: boolean("is_internal").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTicketMessageSchema = createInsertSchema(ticketMessagesTable).omit({ id: true, createdAt: true });
export type InsertTicketMessage = z.infer<typeof insertTicketMessageSchema>;
export type TicketMessage = typeof ticketMessagesTable.$inferSelect;

export const ticketSlaTable = pgTable("ticket_sla", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id).unique(),
  tierSlug: text("tier_slug").notNull(),
  firstResponseTargetMinutes: integer("first_response_target_minutes").notNull(),
  resolutionTargetMinutes: integer("resolution_target_minutes").notNull(),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  firstResponseBreached: boolean("first_response_breached").notNull().default(false),
  firstResponseWarning: boolean("first_response_warning").notNull().default(false),
  resolutionBreached: boolean("resolution_breached").notNull().default(false),
  resolutionWarning: boolean("resolution_warning").notNull().default(false),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  totalPausedMinutes: integer("total_paused_minutes").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TicketSla = typeof ticketSlaTable.$inferSelect;

export const cannedResponsesTable = pgTable("canned_responses", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("general"),
  body: text("body").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCannedResponseSchema = createInsertSchema(cannedResponsesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCannedResponse = z.infer<typeof insertCannedResponseSchema>;
export type CannedResponse = typeof cannedResponsesTable.$inferSelect;

export const ticketRoutingRulesTable = pgTable("ticket_routing_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  priority: text("priority"),
  tierSlug: text("tier_slug"),
  assignToUserId: integer("assign_to_user_id").references(() => usersTable.id),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTicketRoutingRuleSchema = createInsertSchema(ticketRoutingRulesTable).omit({ id: true, createdAt: true });
export type InsertTicketRoutingRule = z.infer<typeof insertTicketRoutingRuleSchema>;
export type TicketRoutingRule = typeof ticketRoutingRulesTable.$inferSelect;

export const ticketSatisfactionTable = pgTable("ticket_satisfaction", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id).unique(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  rating: integer("rating").notNull(),
  feedback: text("feedback"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTicketSatisfactionSchema = createInsertSchema(ticketSatisfactionTable).omit({ id: true, createdAt: true });
export type InsertTicketSatisfaction = z.infer<typeof insertTicketSatisfactionSchema>;
export type TicketSatisfaction = typeof ticketSatisfactionTable.$inferSelect;

// Stores file attachments uploaded with compliance-review (and any future
// attachment-capable ticket types). One row per file. Queried by the admin
// ticket detail page to render clickable download links.
export const ticketAttachmentsTable = pgTable("ticket_attachments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id),
  // Optional link to the specific reply message this file was attached to.
  // Null for attachments uploaded at ticket-creation time (e.g. the initial
  // Compliance Review form) which predate any reply. Set when a member (or
  // future admin reply) uploads a file alongside a thread message so the
  // attachment can be traced back to its message.
  messageId: integer("message_id").references(() => ticketMessagesTable.id),
  // Path returned by the presigned-upload flow, e.g. /objects/uuid-file.ext
  objectPath: text("object_path").notNull(),
  // Original file name as provided by the uploader, for display only
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  contentType: text("content_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TicketAttachment = typeof ticketAttachmentsTable.$inferSelect;
