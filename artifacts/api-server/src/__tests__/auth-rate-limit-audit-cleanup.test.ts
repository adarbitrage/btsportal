import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { db, auditLogTable } from "@workspace/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { runAuthRateLimitAuditCleanup } from "../lib/auth-rate-limit-audit-cleanup";
import {
  AUTH_RATE_LIMIT_AUDIT_ACTION,
  AUTH_RATE_LIMIT_AUDIT_ENTITY,
} from "../routes/auth";

const TAG = `arl-cleanup-${randomUUID().slice(0, 8)}`;
let baselineAuditId = 0;

async function clearTaggedRows() {
  await db
    .delete(auditLogTable)
    .where(
      and(
        gt(auditLogTable.id, baselineAuditId),
        eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION),
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

async function insertAuthRateLimitRow(ageDays: number) {
  const [row] = await db
    .insert(auditLogTable)
    .values({
      actionType: AUTH_RATE_LIMIT_AUDIT_ACTION,
      entityType: AUTH_RATE_LIMIT_AUDIT_ENTITY,
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

async function countTaggedRows() {
  const rows = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION),
        eq(auditLogTable.entityId, TAG),
      ),
    );
  return rows.length;
}

describe("runAuthRateLimitAuditCleanup", () => {
  it("deletes auth_rate_limit_blocked rows older than 30 days and keeps recent ones", async () => {
    await insertAuthRateLimitRow(40);
    await insertAuthRateLimitRow(31);
    await insertAuthRateLimitRow(2);
    await insertAuthRateLimitRow(0);

    const beforeCount = await countTaggedRows();
    expect(beforeCount).toBe(4);

    const deleted = await runAuthRateLimitAuditCleanup();
    expect(deleted).toBeGreaterThanOrEqual(2);

    const remaining = await countTaggedRows();
    expect(remaining).toBe(2);
  });

  it("is idempotent and leaves tagged recent rows alone across repeated runs", async () => {
    await insertAuthRateLimitRow(1);
    await insertAuthRateLimitRow(0);

    await runAuthRateLimitAuditCleanup();
    expect(await countTaggedRows()).toBe(2);

    const secondDeleted = await runAuthRateLimitAuditCleanup();
    expect(secondDeleted).toBe(0);
    expect(await countTaggedRows()).toBe(2);
  });

  it("only touches auth_rate_limit_blocked rows, leaving other audit rows alone", async () => {
    await insertAuthRateLimitRow(40);

    const [other] = await db
      .insert(auditLogTable)
      .values({
        actionType: "admin_action",
        entityType: "member",
        entityId: TAG,
        description: "should not be deleted",
        metadata: { tag: TAG },
      })
      .returning({ id: auditLogTable.id });
    await db.execute(
      sql`UPDATE audit_log SET created_at = NOW() - INTERVAL '60 days' WHERE id = ${other.id}`,
    );

    try {
      const deleted = await runAuthRateLimitAuditCleanup();
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
