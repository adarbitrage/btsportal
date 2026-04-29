import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, emailChangeAttemptsTable } from "@workspace/db";
import { and, eq, sql, isNotNull, isNull } from "drizzle-orm";
import { runEmailChangeAttemptsCleanup } from "../lib/email-change-attempts-cleanup";

const TAG = `ec-cleanup-${randomUUID().slice(0, 8)}`;
let userId: number;

beforeAll(async () => {
  const email = `${TAG}@example.test`;
  const passwordHash = await bcrypt.hash("pw", 4);
  const [row] = await db
    .insert(usersTable)
    .values({ name: "Cleanup Tester", email, passwordHash, role: "member" })
    .returning({ id: usersTable.id });
  userId = row.id;
});

afterAll(async () => {
  await db
    .delete(emailChangeAttemptsTable)
    .where(eq(emailChangeAttemptsTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
});

beforeEach(async () => {
  await db
    .delete(emailChangeAttemptsTable)
    .where(eq(emailChangeAttemptsTable.userId, userId));
});

describe("runEmailChangeAttemptsCleanup", () => {
  it("deletes legacy rate-limit-only rows (no new_email) older than 7 days and keeps recent ones", async () => {
    // Two old rate-limit-only rows that should be removed.
    await db.insert(emailChangeAttemptsTable).values([
      { userId },
      { userId },
    ]);

    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '8 days' WHERE user_id = ${userId} AND new_email IS NULL`,
    );

    // Two recent rate-limit-only rows that should stay.
    await db.insert(emailChangeAttemptsTable).values([
      { userId },
      { userId },
    ]);

    await runEmailChangeAttemptsCleanup();

    const remaining = await db
      .select({ id: emailChangeAttemptsTable.id })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, userId));

    expect(remaining).toHaveLength(2);
  });

  it("keeps audit rows (with new_email) for up to 90 days", async () => {
    // An audit row aged 30 days — well past the legacy 7-day cutoff but
    // within the 90-day audit retention window. Must survive cleanup.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "support-call@example.test",
    });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '30 days' WHERE user_id = ${userId} AND new_email = 'support-call@example.test'`,
    );

    // A legacy rate-limit-only row aged 30 days — should be deleted.
    await db.insert(emailChangeAttemptsTable).values({ userId });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '30 days' WHERE user_id = ${userId} AND new_email IS NULL`,
    );

    await runEmailChangeAttemptsCleanup();

    const auditRows = await db
      .select({ id: emailChangeAttemptsTable.id })
      .from(emailChangeAttemptsTable)
      .where(
        and(
          eq(emailChangeAttemptsTable.userId, userId),
          isNotNull(emailChangeAttemptsTable.newEmail),
        ),
      );
    const legacyRows = await db
      .select({ id: emailChangeAttemptsTable.id })
      .from(emailChangeAttemptsTable)
      .where(
        and(
          eq(emailChangeAttemptsTable.userId, userId),
          isNull(emailChangeAttemptsTable.newEmail),
        ),
      );

    expect(auditRows).toHaveLength(1);
    expect(legacyRows).toHaveLength(0);
  });

  it("deletes audit rows (with new_email) older than 90 days", async () => {
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "ancient@example.test",
    });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '91 days' WHERE user_id = ${userId} AND new_email = 'ancient@example.test'`,
    );

    // A recent audit row that must stay.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "fresh@example.test",
    });

    await runEmailChangeAttemptsCleanup();

    const remaining = await db
      .select({
        id: emailChangeAttemptsTable.id,
        newEmail: emailChangeAttemptsTable.newEmail,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, userId));

    expect(remaining).toHaveLength(1);
    expect(remaining[0].newEmail).toBe("fresh@example.test");
  });

  it("does nothing when there are no old rows", async () => {
    await db.insert(emailChangeAttemptsTable).values([{ userId }, { userId }]);

    await runEmailChangeAttemptsCleanup();

    const remaining = await db
      .select({ id: emailChangeAttemptsTable.id })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, userId));

    expect(remaining).toHaveLength(2);
  });

  it("keeps admin-cancelled rows past the 90-day audit window (longer retention)", async () => {
    // Admin-cancelled row aged 120 days — well past the 90-day audit cutoff,
    // but admin-cancelled rows get the longer 365-day retention so support
    // can still see who cancelled what when working old tickets.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "admin-killed@example.test",
      cancelledAt: new Date(),
      cancelledByAdminId: userId,
    });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '120 days' WHERE user_id = ${userId} AND new_email = 'admin-killed@example.test'`,
    );

    // A non-cancelled audit row of the same age — should be deleted under
    // the 90-day rule. Confirms the cancelled-vs-not split is real.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "abandoned@example.test",
    });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '120 days' WHERE user_id = ${userId} AND new_email = 'abandoned@example.test'`,
    );

    await runEmailChangeAttemptsCleanup();

    const remaining = await db
      .select({
        id: emailChangeAttemptsTable.id,
        newEmail: emailChangeAttemptsTable.newEmail,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, userId));

    expect(remaining).toHaveLength(1);
    expect(remaining[0].newEmail).toBe("admin-killed@example.test");
  });

  it("still treats a row as admin-cancelled even if the admin user was later deleted (cancelledByAdminId nulled out)", async () => {
    // Simulate a row whose original cancelling admin has since been removed:
    // the FK is `onDelete: set null`, so cancelledByAdminId is NULL but
    // cancelledAt is still populated. This row must keep the longer 365-day
    // retention, not silently fall back to the 90-day audit window.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "orphaned-cancel@example.test",
      cancelledAt: new Date(),
      cancelledByAdminId: null,
    });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '120 days' WHERE user_id = ${userId} AND new_email = 'orphaned-cancel@example.test'`,
    );

    await runEmailChangeAttemptsCleanup();

    const remaining = await db
      .select({
        id: emailChangeAttemptsTable.id,
        newEmail: emailChangeAttemptsTable.newEmail,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, userId));

    expect(remaining).toHaveLength(1);
    expect(remaining[0].newEmail).toBe("orphaned-cancel@example.test");
  });

  it("deletes admin-cancelled rows once they pass the 365-day retention window", async () => {
    // Admin-cancelled row aged 366 days — past the longer admin-cancelled
    // retention cap, so it should finally be deleted.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "ancient-admin-kill@example.test",
      cancelledAt: new Date(),
      cancelledByAdminId: userId,
    });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '366 days' WHERE user_id = ${userId} AND new_email = 'ancient-admin-kill@example.test'`,
    );

    // A recent admin-cancelled row that must stay.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "fresh-admin-kill@example.test",
      cancelledAt: new Date(),
      cancelledByAdminId: userId,
    });

    await runEmailChangeAttemptsCleanup();

    const remaining = await db
      .select({
        id: emailChangeAttemptsTable.id,
        newEmail: emailChangeAttemptsTable.newEmail,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, userId));

    expect(remaining).toHaveLength(1);
    expect(remaining[0].newEmail).toBe("fresh-admin-kill@example.test");
  });
});
