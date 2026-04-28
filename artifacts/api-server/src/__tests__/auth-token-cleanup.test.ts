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

import {
  runAuthTokenCleanup,
  runResetTokenCleanup,
  runEmailVerifyTokenCleanup,
} from "../lib/auth-token-cleanup";

const TEST_TAG = `auth-token-cleanup-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

type ResetFields = {
  resetToken: string | null;
  resetTokenExpires: Date | null;
};

type EmailVerifyFields = {
  emailVerifyToken: string | null;
  emailVerifyExpires: Date | null;
  emailVerified?: boolean;
};

async function insertUser(
  suffix: string,
  fields: Partial<ResetFields & EmailVerifyFields> = {},
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
      emailVerified: fields.emailVerified ?? true,
      onboardingComplete: true,
      resetToken: fields.resetToken ?? null,
      resetTokenExpires: fields.resetTokenExpires ?? null,
      emailVerifyToken: fields.emailVerifyToken ?? null,
      emailVerifyExpires: fields.emailVerifyExpires ?? null,
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
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  vi.restoreAllMocks();
});

describe("runResetTokenCleanup", () => {
  it("clears resetToken/resetTokenExpires for users whose reset link has expired", async () => {
    const expiredUserId = await insertUser("reset-expired", {
      resetToken: "deadbeef".repeat(8),
      resetTokenExpires: new Date(Date.now() - 60 * 60 * 1000),
    });

    const cleared = await runResetTokenCleanup();
    expect(cleared).toBeGreaterThanOrEqual(1);

    const after = await getUser(expiredUserId);
    expect(after.resetToken).toBeNull();
    expect(after.resetTokenExpires).toBeNull();
  });

  it("leaves still-valid reset tokens untouched", async () => {
    const futureExpires = new Date(Date.now() + 60 * 60 * 1000);
    const validUserId = await insertUser("reset-valid", {
      resetToken: "cafebabe".repeat(8),
      resetTokenExpires: futureExpires,
    });

    await runResetTokenCleanup();

    const after = await getUser(validUserId);
    expect(after.resetToken).toBe("cafebabe".repeat(8));
    expect(after.resetTokenExpires).toBeInstanceOf(Date);
    expect(after.resetTokenExpires!.getTime()).toBe(futureExpires.getTime());
  });
});

describe("runEmailVerifyTokenCleanup", () => {
  it("clears emailVerifyToken/emailVerifyExpires for users whose verify link has expired", async () => {
    const expiredUserId = await insertUser("verify-expired", {
      emailVerified: false,
      emailVerifyToken: "f00dface".repeat(8),
      emailVerifyExpires: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const cleared = await runEmailVerifyTokenCleanup();
    expect(cleared).toBeGreaterThanOrEqual(1);

    const after = await getUser(expiredUserId);
    expect(after.emailVerifyToken).toBeNull();
    expect(after.emailVerifyExpires).toBeNull();
  });

  it("leaves still-valid email-verify tokens untouched", async () => {
    const futureExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const validUserId = await insertUser("verify-valid", {
      emailVerified: false,
      emailVerifyToken: "abadcafe".repeat(8),
      emailVerifyExpires: futureExpires,
    });

    await runEmailVerifyTokenCleanup();

    const after = await getUser(validUserId);
    expect(after.emailVerifyToken).toBe("abadcafe".repeat(8));
    expect(after.emailVerifyExpires).toBeInstanceOf(Date);
    expect(after.emailVerifyExpires!.getTime()).toBe(futureExpires.getTime());
  });
});

describe("runAuthTokenCleanup", () => {
  it("sweeps both expired reset and email-verify tokens in a single run", async () => {
    const userId = await insertUser("combo-expired", {
      emailVerified: false,
      resetToken: "11111111".repeat(8),
      resetTokenExpires: new Date(Date.now() - 30 * 60 * 1000),
      emailVerifyToken: "22222222".repeat(8),
      emailVerifyExpires: new Date(Date.now() - 30 * 60 * 1000),
    });

    const result = await runAuthTokenCleanup();
    expect(result.resetCleared).toBeGreaterThanOrEqual(1);
    expect(result.emailVerifyCleared).toBeGreaterThanOrEqual(1);

    const after = await getUser(userId);
    expect(after.resetToken).toBeNull();
    expect(after.resetTokenExpires).toBeNull();
    expect(after.emailVerifyToken).toBeNull();
    expect(after.emailVerifyExpires).toBeNull();
  });

  it("ignores users with no reset or email-verify tokens", async () => {
    const cleanUserId = await insertUser("clean");

    await runAuthTokenCleanup();

    const after = await getUser(cleanUserId);
    expect(after.resetToken).toBeNull();
    expect(after.resetTokenExpires).toBeNull();
    expect(after.emailVerifyToken).toBeNull();
    expect(after.emailVerifyExpires).toBeNull();
  });
});
