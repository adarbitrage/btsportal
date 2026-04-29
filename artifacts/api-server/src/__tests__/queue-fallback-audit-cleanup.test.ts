import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { db, auditLogTable } from "@workspace/db";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { runQueueFallbackAuditCleanup } from "../lib/queue-fallback-audit-cleanup";

const TAG = `qfb-cleanup-${randomUUID().slice(0, 8)}`;
let baselineAuditId = 0;

async function clearTaggedRows() {
  await db
    .delete(auditLogTable)
    .where(
      and(
        gt(auditLogTable.id, baselineAuditId),
        inArray(auditLogTable.actionType, ["queue_fallback", "queue_fallback_alert"]),
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

async function insertFallbackRow(ageDays: number, actionType: "queue_fallback" | "queue_fallback_alert" = "queue_fallback") {
  const [row] = await db
    .insert(auditLogTable)
    .values({
      actionType,
      entityType: actionType === "queue_fallback_alert" ? "alert" : "queue",
      entityId: TAG,
      description: `test row aged ${ageDays}d`,
      metadata: { tag: TAG, ageDays },
    })
    .returning({ id: auditLogTable.id });
  if (ageDays > 0) {
    await db.execute(
      sql`UPDATE audit_log SET created_at = NOW() - (${ageDays}::int * INTERVAL '1 day') WHERE id = ${row.id}`,
    );
  }
  return row.id;
}

async function countTaggedRows(actionType: "queue_fallback" | "queue_fallback_alert" = "queue_fallback") {
  const rows = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actionType, actionType),
        eq(auditLogTable.entityId, TAG),
      ),
    );
  return rows.length;
}

describe("runQueueFallbackAuditCleanup", () => {
  it("deletes queue_fallback rows older than 30 days and keeps recent ones", async () => {
    await insertFallbackRow(40);
    await insertFallbackRow(31);
    await insertFallbackRow(2);
    await insertFallbackRow(0);

    const beforeCount = await countTaggedRows();
    expect(beforeCount).toBe(4);

    const deleted = await runQueueFallbackAuditCleanup();
    expect(deleted).toBeGreaterThanOrEqual(2);

    const remaining = await countTaggedRows();
    expect(remaining).toBe(2);
  });

  it("is idempotent and leaves tagged recent rows alone across repeated runs", async () => {
    await insertFallbackRow(1);
    await insertFallbackRow(0);

    await runQueueFallbackAuditCleanup();
    expect(await countTaggedRows()).toBe(2);

    const secondDeleted = await runQueueFallbackAuditCleanup();
    expect(secondDeleted).toBe(0);
    expect(await countTaggedRows()).toBe(2);
  });

  it("also deletes old queue_fallback_alert rows so on-call alert audit history doesn't grow forever", async () => {
    await insertFallbackRow(40, "queue_fallback_alert");
    await insertFallbackRow(31, "queue_fallback_alert");
    await insertFallbackRow(2, "queue_fallback_alert");

    const beforeCount = await countTaggedRows("queue_fallback_alert");
    expect(beforeCount).toBe(3);

    const deleted = await runQueueFallbackAuditCleanup();
    expect(deleted).toBeGreaterThanOrEqual(2);

    const remaining = await countTaggedRows("queue_fallback_alert");
    expect(remaining).toBe(1);
  });

  it("only touches queue_fallback rows, leaving other audit rows alone", async () => {
    await insertFallbackRow(40);

    const [other] = await db
      .insert(auditLogTable)
      .values({
        actionType: "other_action",
        entityType: "queue",
        entityId: TAG,
        description: "should not be deleted",
        metadata: { tag: TAG },
      })
      .returning({ id: auditLogTable.id });
    await db.execute(
      sql`UPDATE audit_log SET created_at = NOW() - INTERVAL '40 days' WHERE id = ${other.id}`,
    );

    try {
      const deleted = await runQueueFallbackAuditCleanup();
      expect(deleted).toBeGreaterThanOrEqual(1);

      const otherStill = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(eq(auditLogTable.id, other.id));
      expect(otherStill).toHaveLength(1);
    } finally {
      await db.delete(auditLogTable).where(eq(auditLogTable.id, other.id));
    }
  });
});
