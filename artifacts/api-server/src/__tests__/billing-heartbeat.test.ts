/**
 * Renewal-charger heartbeat tests — recordChargerRun / getChargerHeartbeat.
 *
 * These exercise the rolling `recent_runs` jsonb log against the REAL database so
 * the runtime SQL (append via `|| to_jsonb(...)`, prune via
 * `jsonb_array_elements` + `(elem::text)::bigint` cast) is proven to execute, not
 * just typecheck. The 24 h count is what the daily digest reports, so it must be
 * derived from the trailing-day window — NOT the monotonic lifetime `run_count`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { db, billingOpsHeartbeatTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordChargerRun, getChargerHeartbeat } from "../lib/billing-heartbeat";

const CHARGER = "charger";
const HOUR_MS = 60 * 60 * 1000;

async function readRow() {
  const [row] = await db
    .select()
    .from(billingOpsHeartbeatTable)
    .where(eq(billingOpsHeartbeatTable.name, CHARGER))
    .limit(1);
  return row;
}

async function seedCharger(recentRuns: number[], runCount: number) {
  const now = new Date();
  await db
    .insert(billingOpsHeartbeatTable)
    .values({ name: CHARGER, lastRunAt: now, runCount, recentRuns, updatedAt: now })
    .onConflictDoUpdate({
      target: billingOpsHeartbeatTable.name,
      set: { lastRunAt: now, runCount, recentRuns, updatedAt: now },
    });
}

describe("renewal-charger heartbeat", () => {
  beforeEach(async () => {
    await db.delete(billingOpsHeartbeatTable).where(eq(billingOpsHeartbeatTable.name, CHARGER));
  });

  it("creates the charger row on first run and reports runsLast24h=1", async () => {
    await recordChargerRun();

    const hb = await getChargerHeartbeat();
    expect(hb.runCount).toBe(1);
    expect(hb.runsLast24h).toBe(1);
    expect(hb.lastRunAt).toBeInstanceOf(Date);
    expect(Date.now() - (hb.lastRunAt as Date).getTime()).toBeLessThan(10_000);
  });

  it("appends each run within 24 h and counts them all; run_count increments", async () => {
    await recordChargerRun();
    await recordChargerRun();
    await recordChargerRun();

    const hb = await getChargerHeartbeat();
    expect(hb.runCount).toBe(3);
    expect(hb.runsLast24h).toBe(3);

    const row = await readRow();
    expect(Array.isArray(row?.recentRuns)).toBe(true);
    expect(row?.recentRuns.length).toBe(3);
  });

  it("prunes stamps older than the 48 h retention window on the next run", async () => {
    const now = Date.now();
    // 49 h old must be pruned by the SQL prune; 10 h old must be retained.
    await seedCharger([now - 49 * HOUR_MS, now - 10 * HOUR_MS], 5);

    await recordChargerRun();

    const row = await readRow();
    const stamps = (row?.recentRuns ?? []) as number[];
    // Only the 10 h-old stamp + the just-appended run survive; 49 h is gone.
    expect(stamps.length).toBe(2);
    expect(stamps.some((t) => t <= now - 48 * HOUR_MS)).toBe(false);
    // run_count is monotonic — the seeded 5 increments to 6.
    expect(row?.runCount).toBe(6);
  });

  it("runsLast24h counts the trailing day only, not the whole retention buffer", async () => {
    const now = Date.now();
    // 30 h old is inside the 48 h retention buffer but OUTSIDE the 24 h window.
    await seedCharger([now - 30 * HOUR_MS, now - 2 * HOUR_MS], 9);

    await recordChargerRun();

    const row = await readRow();
    // SQL prune keeps all three (all < 48 h old).
    expect((row?.recentRuns ?? []).length).toBe(3);

    const hb = await getChargerHeartbeat();
    // But the 24 h count excludes the 30 h-old stamp: only 2 h-old + just-now.
    expect(hb.runsLast24h).toBe(2);
    expect(hb.runCount).toBe(10);
  });
});
