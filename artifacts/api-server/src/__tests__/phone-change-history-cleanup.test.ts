import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, phoneChangeHistoryTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { runPhoneChangeHistoryCleanup } from "../lib/phone-change-history-cleanup";

const TAG = `pch-cleanup-${randomUUID().slice(0, 8)}`;
const userIds: number[] = [];
const oldPhones: string[] = [];

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
  const oldPhone = `${TAG}-${suffix}-old`;
  const newPhone = `${TAG}-${suffix}-new`;
  oldPhones.push(oldPhone);
  await db.insert(phoneChangeHistoryTable).values({
    userId,
    oldPhone,
    newPhone,
    changedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  });
  return oldPhone;
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
  if (oldPhones.length > 0) {
    await db
      .delete(phoneChangeHistoryTable)
      .where(inArray(phoneChangeHistoryTable.oldPhone, oldPhones));
  }
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
});

describe("runPhoneChangeHistoryCleanup", () => {
  it("deletes rows older than ~90 days and leaves recent ones intact", async () => {
    await runPhoneChangeHistoryCleanup();

    const remaining = await db
      .select({ oldPhone: phoneChangeHistoryTable.oldPhone })
      .from(phoneChangeHistoryTable)
      .where(inArray(phoneChangeHistoryTable.oldPhone, oldPhones));

    const remainingPhones = remaining.map((r) => r.oldPhone).sort();
    expect(remainingPhones).toEqual(
      [
        `${TAG}-fresh-old`,
        `${TAG}-recent-old`,
      ].sort(),
    );
  });

  it("is idempotent and safely no-ops when nothing to delete", async () => {
    await runPhoneChangeHistoryCleanup();
    const remaining = await db
      .select({ id: phoneChangeHistoryTable.id })
      .from(phoneChangeHistoryTable)
      .where(inArray(phoneChangeHistoryTable.oldPhone, oldPhones));
    expect(remaining.length).toBe(2);
  });
});
