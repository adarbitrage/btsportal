import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const legalDocumentsTable = pgTable("legal_documents", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  version: integer("version").notNull().default(1),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LegalDocument = typeof legalDocumentsTable.$inferSelect;
