import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { db, upgradePromptEventsTable } from "@workspace/db";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  runUpgradePromptEventsCleanup,
  getUpgradePromptEventsCleanupStatus,
  __resetUpgradePromptEventsCleanupStatusForTests,
} from "../lib/upgrade-prompt-events-cleanup";

const TAG = `upe-cleanup-${randomUUID().slice(0, 8)}`;
let baselineId = 0;

async function clearTaggedRows() {
  await db
    .delete(upgradePromptEventsTable)
    .where(
      and(
        gt(upgradePromptEventsTable.id, baselineId),
        eq(upgradePromptEventsTable.variant, TAG),
      ),
    );
}

beforeAll(async () => {
  const [maxRow] = await db
    .select({ id: upgradePromptEventsTable.id })
    .from(upgradePromptEventsTable)
    .orderBy(sql`${upgradePromptEventsTable.id} DESC`)
    .limit(1);
  baselineId = maxRow?.id ?? 0;
});

afterAll(async () => {
  await clearTaggedRows();
  delete process.env.UPGRADE_PROMPT_EVENTS_RETENTION_DAYS;
});

beforeEach(async () => {
  await clearTaggedRows();
  delete process.env.UPGRADE_PROMPT_EVENTS_RETENTION_DAYS;
  delete process.env.UPGRADE_PROMPT_EVENTS_CLEANUP_INTERVAL_SECONDS;
  __resetUpgradePromptEventsCleanupStatusForTests();
});

async function insertEventRow(ageDays: number, eventType = "impression") {
  const [row] = await db
    .insert(upgradePromptEventsTable)
    .values({
      eventType,
      variant: TAG,
      sourceTier: "free",
      lockedFeatureKeys: [],
      metadata: { tag: TAG, ageDays },
    })
    .returning({ id: upgradePromptEventsTable.id });
  if (ageDays > 0) {
    await db.execute(
      sql`UPDATE upgrade_prompt_events SET created_at = NOW() - (${ageDays}::int * INTERVAL '1 day') WHERE id = ${row.id}`,
    );
  }
  return row.id;
}

async function countTaggedRows() {
  const rows = await db
    .select({ id: upgradePromptEventsTable.id })
    .from(upgradePromptEventsTable)
    .where(eq(upgradePromptEventsTable.variant, TAG));
  return rows.length;
}

describe("runUpgradePromptEventsCleanup", () => {
  it("deletes upgrade_prompt_events rows older than the default 90 day window and keeps recent ones", async () => {
    await insertEventRow(120);
    await insertEventRow(91);
    await insertEventRow(45);
    await insertEventRow(0);

    const beforeCount = await countTaggedRows();
    expect(beforeCount).toBe(4);

    const deleted = await runUpgradePromptEventsCleanup();
    expect(deleted).toBeGreaterThanOrEqual(2);

    const remaining = await countTaggedRows();
    expect(remaining).toBe(2);
  });

  it("is idempotent and leaves recent rows alone across repeated runs", async () => {
    await insertEventRow(1);
    await insertEventRow(0, "cta_click");

    await runUpgradePromptEventsCleanup();
    expect(await countTaggedRows()).toBe(2);

    const secondDeleted = await runUpgradePromptEventsCleanup();
    expect(secondDeleted).toBe(0);
    expect(await countTaggedRows()).toBe(2);
  });

  it("honors UPGRADE_PROMPT_EVENTS_RETENTION_DAYS env override", async () => {
    process.env.UPGRADE_PROMPT_EVENTS_RETENTION_DAYS = "10";

    await insertEventRow(20);
    await insertEventRow(11);
    await insertEventRow(5);

    const deleted = await runUpgradePromptEventsCleanup();
    expect(deleted).toBeGreaterThanOrEqual(2);

    const remaining = await countTaggedRows();
    expect(remaining).toBe(1);
  });

  it("falls back to default retention when env override is invalid", async () => {
    process.env.UPGRADE_PROMPT_EVENTS_RETENTION_DAYS = "not-a-number";

    await insertEventRow(120);
    await insertEventRow(45);

    const deleted = await runUpgradePromptEventsCleanup();
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await countTaggedRows()).toBe(1);
  });
});

describe("getUpgradePromptEventsCleanupStatus", () => {
  it("returns null lastRanAt and lastDeletedCount before the first run", () => {
    const status = getUpgradePromptEventsCleanupStatus();
    expect(status.lastRanAt).toBeNull();
    expect(status.lastDeletedCount).toBeNull();
    expect(status.lastError).toBeNull();
    expect(status.intervalMs).toBeGreaterThan(0);
    expect(status.retentionDays).toBeGreaterThan(0);
    expect(status.stale).toBe(false);
  });

  it("populates lastRanAt and lastDeletedCount after a successful run", async () => {
    await insertEventRow(120);

    const before = Date.now();
    await runUpgradePromptEventsCleanup();
    const after = Date.now();

    const status = getUpgradePromptEventsCleanupStatus();
    expect(status.lastRanAt).not.toBeNull();
    const ranAt = new Date(status.lastRanAt as string).getTime();
    expect(ranAt).toBeGreaterThanOrEqual(before);
    expect(ranAt).toBeLessThanOrEqual(after);
    expect(status.lastDeletedCount).toBeGreaterThanOrEqual(1);
    expect(status.lastError).toBeNull();
  });

  it("reflects the configured retention window from env overrides", () => {
    process.env.UPGRADE_PROMPT_EVENTS_RETENTION_DAYS = "30";
    const status = getUpgradePromptEventsCleanupStatus();
    expect(status.retentionDays).toBe(30);
  });

  it("reflects the configured interval from env overrides", () => {
    process.env.UPGRADE_PROMPT_EVENTS_CLEANUP_INTERVAL_SECONDS = "120";
    const status = getUpgradePromptEventsCleanupStatus();
    expect(status.intervalMs).toBe(120_000);
  });

  it("reports stale=true when the last run is older than 2× the interval", async () => {
    await runUpgradePromptEventsCleanup();
    const status = getUpgradePromptEventsCleanupStatus();
    expect(status.stale).toBe(false);

    const realNow = Date.now;
    Date.now = () => realNow() + 3 * status.intervalMs;
    try {
      const stale = getUpgradePromptEventsCleanupStatus();
      expect(stale.stale).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("reports stale=true when the job has never reported a run after 2× the interval", () => {
    const baseline = getUpgradePromptEventsCleanupStatus();
    expect(baseline.lastRanAt).toBeNull();
    expect(baseline.stale).toBe(false);

    const realNow = Date.now;
    Date.now = () => realNow() + 3 * baseline.intervalMs;
    try {
      const stale = getUpgradePromptEventsCleanupStatus();
      expect(stale.lastRanAt).toBeNull();
      expect(stale.stale).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });
});
