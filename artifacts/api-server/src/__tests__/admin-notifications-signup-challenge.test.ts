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
import {
  __resetSignupChallengeAlerterForTests,
  __setSignupChallengeAlerterDeliveriesForTests,
  type DeliveryResult,
  type SignupChallengeAlertPayload,
} from "../lib/signup-challenge-alerter";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `notif-captcha-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
const seededIds: number[] = [];
const originalSecret = process.env.TURNSTILE_SECRET_KEY;
const originalNodeEnv = process.env.NODE_ENV;

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
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

beforeEach(() => {
  __resetSignupChallengeAlerterForTests();
  delete process.env.TURNSTILE_SECRET_KEY;
});

afterEach(() => {
  __setSignupChallengeAlerterDeliveriesForTests(null);
  delete process.env.TURNSTILE_SECRET_KEY;
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

function makeStubs() {
  const calls: Record<string, SignupChallengeAlertPayload[]> = {
    pagerduty: [],
    email: [],
    slack: [],
  };
  __setSignupChallengeAlerterDeliveriesForTests({
    pagerduty: async (p): Promise<DeliveryResult> => {
      calls.pagerduty.push(p);
      return { channel: "pagerduty", ok: true };
    },
    email: async (p): Promise<DeliveryResult> => {
      calls.email.push(p);
      return { channel: "email", ok: true };
    },
    slack: async (p): Promise<DeliveryResult> => {
      calls.slack.push(p);
      return { channel: "slack", ok: true };
    },
  });
  return calls;
}

describe("GET /api/admin/notifications — signup challenge guard", () => {
  it("emits a high-severity 'signup challenge disabled' notification in production when secret is missing", async () => {
    process.env.NODE_ENV = "production";
    makeStubs();

    const res = await request(app)
      .get("/api/admin/notifications")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const item = res.body.find(
      (n: any) => n.type === "signup_challenge_disabled",
    );
    expect(item).toBeDefined();
    expect(item.severity).toBe("high");
    expect(item.title).toMatch(/signup challenge/i);
    expect(item.link).toBe("/admin/system");
    expect(item.id).toBe("signup-challenge-disabled");
  });

  it("does not emit the notification outside production even if secret is missing", async () => {
    process.env.NODE_ENV = "development";
    makeStubs();

    const res = await request(app)
      .get("/api/admin/notifications")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(
      res.body.some((n: any) => n.type === "signup_challenge_disabled"),
    ).toBe(false);
  });

  it("does not emit the notification in production when secret is configured", async () => {
    process.env.NODE_ENV = "production";
    process.env.TURNSTILE_SECRET_KEY = "real-secret";
    makeStubs();

    const res = await request(app)
      .get("/api/admin/notifications")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(
      res.body.some((n: any) => n.type === "signup_challenge_disabled"),
    ).toBe(false);
  });

  it("fans out to the on-call alerter exactly once across rapid repeat polls", async () => {
    process.env.NODE_ENV = "production";
    const calls = makeStubs();

    // The notifications endpoint is polled every minute by the dashboard.
    // Even after several rapid polls within the throttle window, on-call
    // should only have been paged once per delivery channel.
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .get("/api/admin/notifications")
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);
    }

    // Allow the fire-and-forget alerter dispatches kicked off above to settle
    // before asserting on stub call counts.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(calls.pagerduty.length).toBe(1);
    expect(calls.email.length).toBe(1);
    expect(calls.slack.length).toBe(1);
    expect(calls.pagerduty[0].kind).toBe("fire");
  });
});
