import { pgTable, text, serial, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const knowledgebaseDocsTable = pgTable("knowledgebase_docs", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("faq"),
  content: text("content").notNull(),
  // Visibility flag. `member` docs are eligible for AI Assistant / voice /
  // member chat retrieval; `admin` docs are internal-only and MUST be excluded
  // from every member-facing retrieval path. Additive NOT NULL with a default
  // so existing rows stay member-visible.
  audience: text("audience").notNull().default("member"),
  searchVector: text("search_vector"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("knowledgebase_docs_search_idx").using("gin", sql`to_tsvector('english', ${table.title} || ' ' || ${table.content})`),
  uniqueIndex("knowledgebase_docs_title_uniq").on(table.title),
]);

export const insertKnowledgebaseDocSchema = createInsertSchema(knowledgebaseDocsTable).omit({ id: true, searchVector: true, createdAt: true, updatedAt: true });
export type InsertKnowledgebaseDoc = z.infer<typeof insertKnowledgebaseDocSchema>;
export type KnowledgebaseDoc = typeof knowledgebaseDocsTable.$inferSelect;
