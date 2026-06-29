import { pgTable, text, serial, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Live AI Documents (AI Knowledgebase) ─────────────────────────────────────
// Phase-1 scaffold of the cleanly-separated AI assistant corpus. This table is
// intentionally NEW and EMPTY — it is the future home for AI-citable "live"
// documents, kept distinct from the legacy dual-purpose `knowledgebase_docs`
// from row one. No boot seeders write here and no retrieval path reads here yet;
// migration + retrieval repointing is deferred to phase 2.
export const aiLiveDocumentsTable = pgTable("ai_live_documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  // Stable machine identity, separate from the editable display `title`.
  // Unique (multiple NULLs allowed for rows authored without an explicit slug).
  slug: text("slug"),
  category: text("category").notNull().default("faq"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("ai_live_documents_search_idx").using("gin", sql`to_tsvector('english', ${table.title} || ' ' || ${table.content})`),
  uniqueIndex("ai_live_documents_slug_uniq").on(table.slug),
]);

export const insertAiLiveDocumentSchema = createInsertSchema(aiLiveDocumentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiLiveDocument = z.infer<typeof insertAiLiveDocumentSchema>;
export type AiLiveDocument = typeof aiLiveDocumentsTable.$inferSelect;
