import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Durable, DB-backed heartbeat for billing background jobs.
//
// Deliberately in Postgres (NOT Redis): the failure mode this guards against is
// Redis itself dying. A Redis-only heartbeat would vanish exactly when we most
// need to know the renewal charger stopped running, so the dead-man's-switch
// would fail silent. Keeping it in the primary DB means the daily digest can
// still report "charger last ran at X" even during a full Redis outage.
//
// One row per named job:
//   - "charger": stamped on every processDueRenewals() run. This is the source
//     the daily digest reads to detect a stalled scheduler.
//   - "digest":  stamped when the daily digest is claimed/sent. Used as a
//     cross-process atomic claim so multiple web replicas each running the
//     in-process setInterval scheduler don't all email the same digest.
export const billingOpsHeartbeatTable = pgTable("billing_ops_heartbeat", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull().defaultNow(),
  runCount: integer("run_count").notNull().default(0),
  // Rolling log of recent run timestamps (epoch ms). Appended + pruned to the
  // retention window on every recordChargerRun(), so the daily digest can report
  // a true "runs in last 24 h" count instead of only the monotonic lifetime total.
  recentRuns: jsonb("recent_runs").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillingOpsHeartbeat = typeof billingOpsHeartbeatTable.$inferSelect;
export type InsertBillingOpsHeartbeat = typeof billingOpsHeartbeatTable.$inferInsert;
