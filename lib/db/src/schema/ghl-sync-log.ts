import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const ghlSyncLogTable = pgTable("ghl_sync_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  action: text("action").notNull(),
  direction: text("direction").notNull().default("outbound"),
  payload: jsonb("payload"),
  result: jsonb("result"),
  ghlContactId: text("ghl_contact_id"),
  status: text("status").notNull().default("queued"),
  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertGhlSyncLogSchema = createInsertSchema(ghlSyncLogTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGhlSyncLog = z.infer<typeof insertGhlSyncLogSchema>;
export type GhlSyncLog = typeof ghlSyncLogTable.$inferSelect;
