import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { db, auditLogTable } from "@workspace/db";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  RETENTION_POLICIES,
  runAuditLogRetention,
} from "../lib/audit-log-retention";

const TAG = `alr-${randomUUID().slice(0, 8)}`;
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

async function insertRow(actionType: string, ageDays: number) {
  const [row] = await db
    .insert(auditLogTable)
    .values({
      actionType,
      entityType: "audit_log_retention_test",
      entityId: TAG,
      description: `test ${actionType} aged ${ageDays}d`,
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

async function countTagged(actionType: string) {
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

describe("runAuditLogRetention", () => {
  // Drive the per-policy assertions off the registry itself so a new
  // policy added to RETENTION_POLICIES is automatically covered (or
  // forces the test author to add a fixture for it).
  for (const policy of RETENTION_POLICIES) {
    for (const actionType of policy.actionTypes) {
      describe(`policy "${policy.label}" (${actionType}, ${policy.retentionDays}d)`, () => {
        it("deletes rows older than the retention window and keeps recent rows", async () => {
          const beyond = policy.retentionDays + 5;
          const justOver = policy.retentionDays + 1;
          await insertRow(actionType, beyond);
          await insertRow(actionType, justOver);
          await insertRow(actionType, 1);
          await insertRow(actionType, 0);

          expect(await countTagged(actionType)).toBe(4);

          await runAuditLogRetention();

          // The retention sweep is action-type-wide, so it can also delete
          // unrelated old rows of the same actionType written by other
          // tests/runs. We assert the post-state of OUR tagged rows only.
          expect(await countTagged(actionType)).toBe(2);
        });

        it("is idempotent: a second run deletes no additional tagged rows", async () => {
          await insertRow(actionType, 1);
          await insertRow(actionType, 0);
          await runAuditLogRetention();
          expect(await countTagged(actionType)).toBe(2);

          await runAuditLogRetention();
          expect(await countTagged(actionType)).toBe(2);
        });

        it("does not touch other action types, even when they're old", async () => {
          await insertRow(actionType, policy.retentionDays + 5);

          // Use a sentinel action type that is guaranteed NOT to appear
          // in any retention policy, so it must survive the sweep.
          const SENTINEL = `sentinel_${TAG}`;
          const [other] = await db
            .insert(auditLogTable)
            .values({
              actionType: SENTINEL,
              entityType: "audit_log_retention_test",
              entityId: TAG,
              description: "should never be deleted",
              metadata: { tag: TAG },
            })
            .returning({ id: auditLogTable.id });
          await db.execute(
            sql`UPDATE audit_log SET created_at = NOW() - INTERVAL '3650 days' WHERE id = ${other.id}`,
          );

          await runAuditLogRetention();

          const otherStill = await db
            .select({ id: auditLogTable.id })
            .from(auditLogTable)
            .where(eq(auditLogTable.id, other.id));
          expect(otherStill).toHaveLength(1);
        });
      });
    }
  }

  it("returns a per-policy summary so callers can see which policies fired", async () => {
    const results = await runAuditLogRetention();
    expect(results).toHaveLength(RETENTION_POLICIES.length);
    for (const policy of RETENTION_POLICIES) {
      const found = results.find((r) => r.label === policy.label);
      expect(found, `expected a result entry for policy ${policy.label}`).toBeDefined();
      expect(typeof found!.deleted).toBe("number");
      expect(found!.deleted).toBeGreaterThanOrEqual(0);
    }
  });
});
