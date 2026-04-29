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
});
