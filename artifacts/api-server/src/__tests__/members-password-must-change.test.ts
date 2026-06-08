import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    sendEmailNow: vi.fn(async () => ({ result: "sent" })),
    queueEmail: vi.fn(async () => ({ result: "queued" })),
  },
}));

import { buildTestAppWithRouters } from "./test-app";
import membersRouter from "../routes/members";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `must-change-pw-${randomUUID().slice(0, 8)}`;
const TEMP_PASSWORD = "TempPassw0rd!";

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertStaff(suffix: string) {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role: "support_agent",
      emailVerified: true,
      onboardingComplete: true,
      mustChangePassword: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email };
}

beforeAll(() => {
  app = buildTestAppWithRouters([membersRouter]);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /api/members/me/password — mustChangePassword flag", () => {
  it("clears mustChangePassword once the staffer sets a new password", async () => {
    const staff = await insertStaff("clears");

    const res = await request(app)
      .post("/api/members/me/password")
      .set("Cookie", signCookie(staff.id, staff.email))
      .send({ currentPassword: TEMP_PASSWORD, newPassword: "BrandNewPass1" });

    expect(res.status).toBe(200);

    const [stored] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, staff.id));
    expect(stored.mustChangePassword).toBe(false);
    // New password actually took effect.
    expect(await bcrypt.compare("BrandNewPass1", stored.passwordHash)).toBe(true);
  });

  it("leaves mustChangePassword set when the change is rejected (wrong temp password)", async () => {
    const staff = await insertStaff("rejected");

    const res = await request(app)
      .post("/api/members/me/password")
      .set("Cookie", signCookie(staff.id, staff.email))
      .send({ currentPassword: "not-the-temp-password", newPassword: "BrandNewPass1" });

    expect(res.status).toBe(400);

    const [stored] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, staff.id));
    expect(stored.mustChangePassword).toBe(true);
  });
});
