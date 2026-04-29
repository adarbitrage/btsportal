import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: vi.fn(async () => false),
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `health-captcha-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
const seededIds: number[] = [];
const originalSecret = process.env.TURNSTILE_SECRET_KEY;

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const email = `${TEST_TAG}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Test super admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  adminCookie = `access_token=${token}`;
});

afterAll(async () => {
  if (seededIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededIds));
  }
  if (originalSecret === undefined) {
    delete process.env.TURNSTILE_SECRET_KEY;
  } else {
    process.env.TURNSTILE_SECRET_KEY = originalSecret;
  }
});

beforeEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
});

afterEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
});

describe("GET /api/admin/system/health — signup challenge field", () => {
  it("reports enforced=false when TURNSTILE_SECRET_KEY is unset", async () => {
    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body?.services?.signupChallenge).toEqual({ enforced: false });
  });

  it("reports enforced=false when TURNSTILE_SECRET_KEY is an empty string", async () => {
    process.env.TURNSTILE_SECRET_KEY = "   ";

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body?.services?.signupChallenge).toEqual({ enforced: false });
  });

  it("reports enforced=true when TURNSTILE_SECRET_KEY is set to a non-empty value", async () => {
    process.env.TURNSTILE_SECRET_KEY = "real-secret-value";

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body?.services?.signupChallenge).toEqual({ enforced: true });
  });

  it("includes the email-change attempts retention policy sourced from the cleanup module", async () => {
    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const retention = res.body?.services?.emailChangeAttemptsRetention;
    expect(retention).toBeTruthy();
    const {
      RATE_LIMIT_RETENTION_DAYS,
      AUDIT_RETENTION_DAYS,
      ADMIN_CANCELLED_RETENTION_DAYS,
    } = await import("../lib/email-change-attempts-cleanup");
    expect(retention).toEqual({
      rateLimitRetentionDays: RATE_LIMIT_RETENTION_DAYS,
      auditRetentionDays: AUDIT_RETENTION_DAYS,
      adminCancelledRetentionDays: ADMIN_CANCELLED_RETENTION_DAYS,
    });
  });

  it("includes an abuseRateLimitCleanup status field", async () => {
    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const arl = res.body?.services?.abuseRateLimitCleanup;
    expect(arl).toBeTruthy();
    expect(typeof arl.enabled).toBe("boolean");
    expect(typeof arl.intervalMs).toBe("number");
    expect(arl.intervalMs).toBeGreaterThan(0);
    expect(typeof arl.stale).toBe("boolean");
    // lastRanAt and lastResult may be null before any sweep has run; both
    // shapes are valid as long as the keys are present.
    expect(arl).toHaveProperty("lastRanAt");
    expect(arl).toHaveProperty("lastResult");
    expect(arl).toHaveProperty("lastError");
  });

  it("never echoes the secret value back in the response", async () => {
    const secret = "super-secret-do-not-leak-1234567890";
    process.env.TURNSTILE_SECRET_KEY = secret;

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });
});
