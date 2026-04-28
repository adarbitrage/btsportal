import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, emailChangeHistoryTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { runEmailChangeHistoryCleanup } from "../lib/email-change-history-cleanup";

const TAG = `ech-cleanup-${randomUUID().slice(0, 8)}`;
const userIds: number[] = [];
const oldEmails: string[] = [];

async function seedUser(): Promise<number> {
  const hash = await bcrypt.hash("Password1!", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-${userIds.length}@example.test`,
      name: "Cleanup Test",
      passwordHash: hash,
      role: "member",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  userIds.push(row.id);
  return row.id;
}

async function seedHistory(userId: number, daysAgo: number, suffix: string) {
  const oldEmail = `${TAG}-${suffix}-old@example.test`;
  const newEmail = `${TAG}-${suffix}-new@example.test`;
  oldEmails.push(oldEmail);
  await db.insert(emailChangeHistoryTable).values({
    userId,
    oldEmail,
    newEmail,
    changedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  });
  return oldEmail;
}

beforeAll(async () => {
  const u1 = await seedUser();
  const u2 = await seedUser();
  const u3 = await seedUser();
  await seedHistory(u1, 120, "ancient"); // > 90d, should be deleted
  await seedHistory(u2, 95, "stale");    // > 90d, should be deleted
  await seedHistory(u3, 45, "fresh");    // < 90d, should remain
  await seedHistory(u3, 5, "recent");    // < 90d, should remain
});

afterAll(async () => {
  if (oldEmails.length > 0) {
    await db
      .delete(emailChangeHistoryTable)
      .where(inArray(emailChangeHistoryTable.oldEmail, oldEmails));
  }
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
});

describe("runEmailChangeHistoryCleanup", () => {
  it("deletes rows older than ~90 days and leaves recent ones intact", async () => {
    await runEmailChangeHistoryCleanup();

    const remaining = await db
      .select({ oldEmail: emailChangeHistoryTable.oldEmail })
      .from(emailChangeHistoryTable)
      .where(inArray(emailChangeHistoryTable.oldEmail, oldEmails));

    const remainingEmails = remaining.map((r) => r.oldEmail).sort();
    expect(remainingEmails).toEqual(
      [
        `${TAG}-fresh-old@example.test`,
        `${TAG}-recent-old@example.test`,
      ].sort(),
    );
  });

  it("is idempotent and safely no-ops when nothing to delete", async () => {
    await runEmailChangeHistoryCleanup();
    const remaining = await db
      .select({ id: emailChangeHistoryTable.id })
      .from(emailChangeHistoryTable)
      .where(inArray(emailChangeHistoryTable.oldEmail, oldEmails));
    expect(remaining.length).toBe(2);
  });
});
