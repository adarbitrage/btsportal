import { pgTable, text, serial, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").references(() => usersTable.id),
  actorEmail: text("actor_email"),
  actionType: text("action_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  description: text("description").notNull(),
  changeDiff: jsonb("change_diff"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Composite index that backs keyset pagination on the admin Audit Log
  // endpoint. Postgres can scan a btree in either direction, so the same
  // index serves both `ORDER BY created_at DESC, id DESC` (forward / older
  // page) and `ORDER BY created_at ASC, id ASC` (backward / newer page),
  // and it lets `expand=<id>` deep-links resolve the surrounding window in
  // O(log n + page_size) instead of counting every preceding row.
  index("audit_log_created_at_id_idx").on(table.createdAt, table.id),
]);

export type AuditLog = typeof auditLogTable.$inferSelect;
export type InsertAuditLog = typeof auditLogTable.$inferInsert;
