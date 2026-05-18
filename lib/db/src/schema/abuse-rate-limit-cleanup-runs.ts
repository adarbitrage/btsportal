import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";

// Durable history of every completed `runAbuseRateLimitCleanup` invocation,
// both successful and failed. The in-process ring buffer that backs the
// "Trimmed per run" sparkline on the System Health page is wiped on every
// API server restart (deploy, crash, scale event), which leaves on-call
// staring at an empty chart until ~24 hours of sweeps re-populate it.
// Persisting each run here lets the chart be hydrated immediately after
// a restart and lets us compare today's sweep volume against yesterday's
// across deploys.
//
// One row per run. The `error_message` column is non-null when the sweep
// itself threw (the in-memory `lastError` is derived from the most recent
// row's `error_message`), so the same row doubles as a heartbeat and as
// the failure record. Rows older than the retention window are pruned by
// the cleanup job itself so the table never grows without bound.
export const abuseRateLimitCleanupRunsTable = pgTable(
  "abuse_rate_limit_cleanup_runs",
  {
    id: serial("id").primaryKey(),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
    scanned: integer("scanned").notNull().default(0),
    trimmed: integer("trimmed").notNull().default(0),
    deleted: integer("deleted").notNull().default(0),
    errorMessage: text("error_message"),
  },
  (table) => [
    // The status endpoint reads the latest N rows ordered by `ran_at DESC`
    // on every System Health page load and every alerter poll; this index
    // keeps that read O(log n + page_size) instead of a full sort.
    index("abuse_rate_limit_cleanup_runs_ran_at_idx").on(table.ranAt),
  ],
);

export type AbuseRateLimitCleanupRun = typeof abuseRateLimitCleanupRunsTable.$inferSelect;
export type InsertAbuseRateLimitCleanupRun = typeof abuseRateLimitCleanupRunsTable.$inferInsert;
