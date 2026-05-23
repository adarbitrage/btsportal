import { pgTable, text, serial, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const webhookLogsTable = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull().default("received"),
  payload: jsonb("payload").notNull(),
  result: jsonb("result"),
  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  // Set the first time a row is reported to on-call as "exhausted retries"
  // (status='failed', attempts >= MAX_ATTEMPTS, result IS NULL). Used by
  // `yse-grant-exhausted-alerter.ts` as the "have we already paged about
  // this row?" gate so a single stuck grant doesn't re-page on every sweep,
  // and surfaced on the admin pending-deliveries view so the team can see
  // alert-sent state. Only written AFTER the dispatch actually attempted
  // delivery — paired with `alertClaimedAt` below to give us crash-safe
  // exactly-once paging across pods.
  alertSentAt: timestamp("alert_sent_at", { withTimezone: true }),
  // Transient lease used by `yse-grant-exhausted-alerter.ts` to claim a
  // row before dispatching, so two pods evaluating concurrently don't
  // both page on-call for the same row. The lease auto-expires after
  // `ALERT_CLAIM_TTL_MS` so a pod that crashes between claim and dispatch
  // releases the row on the next sweep — `alert_sent_at` is only set
  // once a dispatch actually attempts delivery.
  alertClaimedAt: timestamp("alert_claimed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Partial index that backs the retry-dispatcher's "what's due to retry next?"
  // lookup. The dispatcher polls every few seconds with
  //   WHERE status = 'failed' AND result IS NULL AND next_retry_at <= now()
  // ordered by (event_type, next_retry_at), so a partial btree on exactly
  // that predicate keeps the scan tiny even as the table grows. Mirrors the
  // raw-SQL index created in 0033_webhook_logs_retry_columns.sql; declared
  // here so `drizzle-kit push` produces the same constraint set.
  index("webhook_logs_retry_idx")
    .on(table.eventType, table.status, table.nextRetryAt)
    .where(sql`"status" = 'failed' AND "result" IS NULL`),
  // Partial index that backs `yse-grant-exhausted-alerter.ts`'s sweep for
  // rows that are out of retries but haven't been paged about yet
  // (status='failed', result IS NULL, alert_sent_at IS NULL). Without it
  // every sweep would full-scan webhook_logs. Mirrors the raw-SQL index
  // created in 0034_webhook_logs_alert_sent_at.sql; declared here so
  // `drizzle-kit push` produces the same constraint set.
  index("webhook_logs_exhausted_unalerted_idx")
    .on(table.eventType, table.attempts)
    .where(sql`"status" = 'failed' AND "result" IS NULL AND "alert_sent_at" IS NULL`),
]);

export const insertWebhookLogSchema = createInsertSchema(webhookLogsTable).omit({ id: true, createdAt: true });
export type InsertWebhookLog = z.infer<typeof insertWebhookLogSchema>;
export type WebhookLog = typeof webhookLogsTable.$inferSelect;
