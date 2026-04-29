import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { db, upgradePromptEventsTable } from "@workspace/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { runUpgradePromptEventsCleanup } from "../lib/upgrade-prompt-events-cleanup";

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
