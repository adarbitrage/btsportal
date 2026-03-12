import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const apiRequestLogTable = pgTable("api_request_log", {
  id: serial("id").primaryKey(),
  requestId: text("request_id").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code"),
  responseTimeMs: integer("response_time_ms"),
  apiKeyId: integer("api_key_id"),
  apiKeyPrefix: text("api_key_prefix"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApiRequestLog = typeof apiRequestLogTable.$inferSelect;
export type InsertApiRequestLog = typeof apiRequestLogTable.$inferInsert;
