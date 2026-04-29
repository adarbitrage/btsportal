import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { db, auditLogTable } from "@workspace/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { runLegacyQueueFallbackDuplicateCleanup } from "../lib/queue-fallback-legacy-duplicate-cleanup";

const TAG = `qfb-dup-cleanup-${randomUUID().slice(0, 8)}`;
let baselineAuditId = 0;

async function clearTaggedRows() {
  await db
    .delete(auditLogTable)
    .where(
      and(
        gt(auditLogTable.id, baselineAuditId),
        eq(auditLogTable.entityId, TAG),
      ),
    );
}

beforeAll(async () => {
  const [maxRow] = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .orderBy(sql`${auditLogTable.id} DESC`)
    .limit(1);
  baselineAuditId = maxRow?.id ?? 0;
});

afterAll(async () => {
  await clearTaggedRows();
});

beforeEach(async () => {
  await clearTaggedRows();
});

async function insertRow(actionType: string, entityType: string) {
  const [row] = await db
    .insert(auditLogTable)
    .values({
      actionType,
      entityType,
      entityId: TAG,
      description: `test ${actionType}/${entityType}`,
      metadata: { tag: TAG },
    })
    .returning({ id: auditLogTable.id });
  return row.id;
}

async function countTaggedRows(actionType: string, entityType: string) {
  const rows = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.entityId, TAG),
        eq(auditLogTable.actionType, actionType),
        eq(auditLogTable.entityType, entityType),
      ),
    );
  return rows.length;
}

describe("runLegacyQueueFallbackDuplicateCleanup", () => {
  it("deletes legacy duplicate rows (queue_fallback + communication) regardless of age", async () => {
    await insertRow("queue_fallback", "communication");
    await insertRow("queue_fallback", "communication");
    await insertRow("queue_fallback", "communication");

    const before = await countTaggedRows("queue_fallback", "communication");
    expect(before).toBe(3);

    const deleted = await runLegacyQueueFallbackDuplicateCleanup();
    expect(deleted).toBeGreaterThanOrEqual(3);

    const after = await countTaggedRows("queue_fallback", "communication");
    expect(after).toBe(0);
  });

  it("leaves the surviving queue_fallback/queue rows alone", async () => {
    await insertRow("queue_fallback", "queue");
    await insertRow("queue_fallback", "queue");
    await insertRow("queue_fallback", "communication");

    await runLegacyQueueFallbackDuplicateCleanup();

    expect(await countTaggedRows("queue_fallback", "queue")).toBe(2);
    expect(await countTaggedRows("queue_fallback", "communication")).toBe(0);
  });

  it("does not touch unrelated communication audit rows", async () => {
    await insertRow("send_email", "communication");
    await insertRow("queue_fallback", "communication");

    await runLegacyQueueFallbackDuplicateCleanup();

    expect(await countTaggedRows("send_email", "communication")).toBe(1);
    expect(await countTaggedRows("queue_fallback", "communication")).toBe(0);
  });

  it("is idempotent — a second run finds nothing to delete", async () => {
    await insertRow("queue_fallback", "communication");

    const first = await runLegacyQueueFallbackDuplicateCleanup();
    expect(first).toBeGreaterThanOrEqual(1);

    const second = await runLegacyQueueFallbackDuplicateCleanup();
    expect(second).toBe(0);
  });
});
