import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const signedDocumentsTable = pgTable("signed_documents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  documentType: text("document_type").notNull(),
  documentVersion: integer("document_version").notNull(),
  signature: text("signature").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
});

export type SignedDocument = typeof signedDocumentsTable.$inferSelect;
