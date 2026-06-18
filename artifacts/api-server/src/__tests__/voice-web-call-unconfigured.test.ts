import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

// voice.ts captures RETELL_API_KEY / RETELL_AGENT_ID into module-level consts at
// import time, and POST /voice/web-call short-circuits with a 500 unless BOTH are
// set. The sibling voice-member-endpoints suite deliberately seeds them to reach
// the entitlement + cap gates, so this case lives in its own module: clear the
// vars BEFORE the router is imported (vi.hoisted runs ahead of the static import
// below) so the consts capture "" and the missing-config branch is exercised. A
// separate file keeps that seeding from leaking in via shared process.env.
vi.hoisted(() => {
  delete process.env.RETELL_API_KEY;
  delete process.env.RETELL_AGENT_ID;
});

// Mock the Retell SDK so a misconfigured run can never reach the live service.
// The missing-config guard must reject before any SDK call is attempted.
const retellMock = vi.hoisted(() => ({ createWebCall: vi.fn() }));
vi.mock("retell-sdk", () => ({
  default: class {
    call = { createWebCall: retellMock.createWebCall };
  },
}));

import voiceRouter from "../routes/voice";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `voice-unconfig-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedAdmin(suffix: string): Promise<{ id: number; cookie: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, cookie: signCookie(row.id, email) };
}

beforeAll(() => {
  app = buildTestAppWithRouters([voiceRouter]);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  retellMock.createWebCall.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/voice/web-call (unconfigured)", () => {
  it("returns 500 'Voice assistant is not configured' when RETELL keys are absent", async () => {
    // An admin would otherwise sail past the entitlement + cap gates, so a 500
    // here proves the missing-config guard fires first — before any auth check.
    const admin = await seedAdmin("admin");

    const res = await request(app).post("/api/voice/web-call").set("Cookie", admin.cookie);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Voice assistant is not configured");
    // The guard must short-circuit before the Retell SDK is ever touched.
    expect(retellMock.createWebCall).not.toHaveBeenCalled();
  });
});
