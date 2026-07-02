import { pgTable, text, serial, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

/**
 * Admin-manageable TOOL-tag vocabulary (Task #1586).
 *
 * The KB tag vocabulary used to be entirely hard-coded in the api-server
 * kb-taxonomy registry. Concept tags and the single troubleshooting tag stay
 * code-defined (they change with the product's marketing craft, not day-to-day),
 * but the TOOL / software / platform tags churn as new AI tools appear. Those
 * now live here so an admin can view / add / edit / disable / delete them with
 * no deploy. Retrieval + triage read a MERGED "effective" vocabulary
 * (DB tool tags + code concept tags + troubleshooting) — see the api-server
 * kb-tool-tags module.
 */
export const kbToolTagsTable = pgTable("kb_tool_tags", {
  id: serial("id").primaryKey(),
  // Controlled slug (lowercase, hyphenated) — the value stored on a doc's tags.
  slug: text("slug").notNull().unique(),
  // Human label shown in the admin UI.
  label: text("label").notNull(),
  // Member-facing phrasings that map a free-text query onto this tag (retrieval
  // boost triggers). Matched on word boundaries by detectQueryTags.
  triggers: jsonb("triggers").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // Disabled tags drop out of the effective vocabulary (retrieval/triage stop
  // suggesting/boosting them) but the row is preserved for history/re-enable.
  enabled: boolean("enabled").notNull().default(true),
  // Protected tags (the ad-publisher source-protected code names) cannot be
  // disabled or deleted from the admin UI.
  protected: boolean("protected").notNull().default(false),
  // Provenance: 'seed' (shipped baseline), 'admin' (hand-added), 'ai_approved'
  // (promoted from the AI-proposes queue).
  source: text("source").notNull().default("seed"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("kb_tool_tags_enabled_idx").on(table.enabled),
]);

export type KbToolTag = typeof kbToolTagsTable.$inferSelect;
export type InsertKbToolTag = typeof kbToolTagsTable.$inferInsert;

/**
 * AI-proposes / human-approves queue. When triage notices a tool / software /
 * platform name in a document that is NOT already in the effective vocabulary,
 * it records (or increments) a proposal here. A human approves it into
 * kb_tool_tags or rejects it — the AI never creates a live tag on its own.
 */
export const kbProposedToolTagsTable = pgTable("kb_proposed_tool_tags", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  suggestedTriggers: jsonb("suggested_triggers").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // 'pending' | 'approved' | 'rejected'.
  status: text("status").notNull().default("pending"),
  // How many times this tool name has been observed across triaged docs.
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  // An example doc title where the tool was seen (context for the reviewer).
  exampleContext: text("example_context"),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("kb_proposed_tool_tags_status_idx").on(table.status),
]);

export type KbProposedToolTag = typeof kbProposedToolTagsTable.$inferSelect;
export type InsertKbProposedToolTag = typeof kbProposedToolTagsTable.$inferInsert;
