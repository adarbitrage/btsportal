import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => "job_test_id"),
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

import { runPendingEmailCleanup } from "../lib/pending-email-cleanup";

const TEST_TAG = `pending-email-cleanup-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

async function insertUser(
  suffix: string,
  pending: {
    pendingEmail: string | null;
    emailChangeToken: string | null;
    emailChangeExpires: Date | null;
  },
): Promise<number> {
  const passwordHash = await bcrypt.hash("OriginalPassw0rd!", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-${suffix}@example.test`,
      name: `Test ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      pendingEmail: pending.pendingEmail,
      emailChangeToken: pending.emailChangeToken,
      emailChangeExpires: pending.emailChangeExpires,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function getUser(userId: number) {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return row;
}

beforeAll(() => {
  // Silence the console.log output from the cleanup helper during tests.
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  vi.restoreAllMocks();
});

describe("runPendingEmailCleanup", () => {
  it("clears pendingEmail/token/expires for users whose pending change has expired", async () => {
    const expiredUserId = await insertUser("expired", {
      pendingEmail: `${TEST_TAG}-expired-new@example.test`,
      emailChangeToken: "deadbeef".repeat(8),
      emailChangeExpires: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
    });

    const cleared = await runPendingEmailCleanup();
    expect(cleared).toBeGreaterThanOrEqual(1);

    const after = await getUser(expiredUserId);
    expect(after.pendingEmail).toBeNull();
    expect(after.emailChangeToken).toBeNull();
    expect(after.emailChangeExpires).toBeNull();
  });

  it("leaves still-valid pending email changes untouched", async () => {
    const futureExpires = new Date(Date.now() + 60 * 60 * 1000); // +1h
    const validUserId = await insertUser("valid", {
      pendingEmail: `${TEST_TAG}-valid-new@example.test`,
      emailChangeToken: "cafebabe".repeat(8),
      emailChangeExpires: futureExpires,
    });

    await runPendingEmailCleanup();

    const after = await getUser(validUserId);
    expect(after.pendingEmail).toBe(`${TEST_TAG}-valid-new@example.test`);
    expect(after.emailChangeToken).toBe("cafebabe".repeat(8));
    expect(after.emailChangeExpires).toBeInstanceOf(Date);
    expect(after.emailChangeExpires!.getTime()).toBe(futureExpires.getTime());
  });

  it("ignores users with no pending change", async () => {
    const cleanUserId = await insertUser("clean", {
      pendingEmail: null,
      emailChangeToken: null,
      emailChangeExpires: null,
    });

    await runPendingEmailCleanup();

    const after = await getUser(cleanUserId);
    expect(after.pendingEmail).toBeNull();
    expect(after.emailChangeToken).toBeNull();
    expect(after.emailChangeExpires).toBeNull();
  });
});
