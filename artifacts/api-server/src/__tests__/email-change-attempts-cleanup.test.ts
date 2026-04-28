import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, emailChangeAttemptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
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
  it("deletes rows older than 7 days and keeps recent rows", async () => {
    await db.insert(emailChangeAttemptsTable).values([
      { userId },
      { userId },
    ]);

    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '8 days' WHERE user_id = ${userId}`,
    );

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
