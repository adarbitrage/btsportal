import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
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
  GUARDED_SECRETS,
  __resetProductionEnvGuardForTests,
  __setProductionEnvGuardDeliveriesForTests,
  type DeliveryResult as ProdEnvDeliveryResult,
} from "../lib/production-env-guard";
import {
  __resetSignupChallengeAlerterForTests,
  __setSignupChallengeAlerterDeliveriesForTests,
  type DeliveryResult as SignupDeliveryResult,
} from "../lib/signup-challenge-alerter";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `notif-limit-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
const seededIds: number[] = [];
const ALL_GUARDED_ENV_VARS = GUARDED_SECRETS.map((s) => s.envVar);
const originalEnvSnapshot: Record<string, string | undefined> = {};

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
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, {
    expiresIn: "1h",
  });
  adminCookie = `access_token=${token}`;

  for (const k of [...ALL_GUARDED_ENV_VARS, "NODE_ENV", "TURNSTILE_SECRET_KEY"]) {
    originalEnvSnapshot[k] = process.env[k];
  }
});

afterAll(async () => {
  if (seededIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededIds));
  }
  for (const [k, v] of Object.entries(originalEnvSnapshot)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
});

function configureAllSecrets(): void {
  for (const s of GUARDED_SECRETS) {
    process.env[s.envVar] = `real-${s.envVar.toLowerCase()}-value`;
  }
  process.env.TURNSTILE_SECRET_KEY = "real-turnstile-secret";
}

function clearAllGuardedSecrets(): void {
  for (const s of GUARDED_SECRETS) delete process.env[s.envVar];
  delete process.env.TURNSTILE_SECRET_KEY;
}

function stubAllOnCallDeliveries(): void {
  // Swallow on-call deliveries so the route's fire-and-forget alerter calls
  // don't try to talk to PagerDuty/Slack/SendGrid during the test.
  __setProductionEnvGuardDeliveriesForTests({
    pagerduty: async (p): Promise<ProdEnvDeliveryResult> =>
      ({ channel: "pagerduty", secretId: p.secret.id, ok: true }),
    email: async (p): Promise<ProdEnvDeliveryResult> =>
      ({ channel: "email", secretId: p.secret.id, ok: true }),
    slack: async (p): Promise<ProdEnvDeliveryResult> =>
      ({ channel: "slack", secretId: p.secret.id, ok: true }),
  });
  __setSignupChallengeAlerterDeliveriesForTests({
    pagerduty: async (): Promise<SignupDeliveryResult> =>
      ({ channel: "pagerduty", ok: true }),
    email: async (): Promise<SignupDeliveryResult> =>
      ({ channel: "email", ok: true }),
    slack: async (): Promise<SignupDeliveryResult> =>
      ({ channel: "slack", ok: true }),
  });
}

beforeEach(() => {
  __resetProductionEnvGuardForTests();
  __resetSignupChallengeAlerterForTests();
  configureAllSecrets();
});

afterEach(() => {
  __setProductionEnvGuardDeliveriesForTests(null);
  __setSignupChallengeAlerterDeliveriesForTests(null);
  for (const [k, v] of Object.entries(originalEnvSnapshot)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
});

describe("GET /api/admin/notifications — ?limit support", () => {
  it("returns the legacy bare-array shape when no limit is requested", async () => {
    // Backwards-compat guard: anything still calling the unparameterized
    // endpoint (older SPAs, scripts, integration tests) must keep getting
    // the same array-of-notifications response it always has.
    process.env.NODE_ENV = "development";

    const res = await request(app)
      .get("/api/admin/notifications")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns the wrapped { notifications, total } shape when ?limit is set", async () => {
    // The wrapped shape is what lets the bell badge keep showing the true
    // count even when the items array is truncated to N.
    process.env.NODE_ENV = "development";

    const res = await request(app)
      .get("/api/admin/notifications?limit=50")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(false);
    expect(Array.isArray(res.body.notifications)).toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(res.body.notifications.length).toBeLessThanOrEqual(50);
    expect(res.body.total).toBe(res.body.notifications.length);
  });

  it("truncates `notifications` to the requested limit while keeping `total` accurate", async () => {
    // Force a multi-notification scenario by pretending we're in production
    // with every guarded secret missing. That alone produces N items
    // (one per guarded secret) plus the signup-challenge item, so we
    // comfortably exceed limit=2 here without needing real ticket data.
    process.env.NODE_ENV = "production";
    clearAllGuardedSecrets();
    stubAllOnCallDeliveries();

    const unlimited = await request(app)
      .get("/api/admin/notifications")
      .set("Cookie", adminCookie);
    expect(unlimited.status).toBe(200);
    const totalNotifications = unlimited.body.length;
    expect(totalNotifications).toBeGreaterThan(2);

    // Reset alerter state so the second call's fire-and-forget dispatches
    // also exit cleanly through the stubs (no shared throttle inversion).
    __resetProductionEnvGuardForTests();
    __resetSignupChallengeAlerterForTests();
    stubAllOnCallDeliveries();

    const limited = await request(app)
      .get("/api/admin/notifications?limit=2")
      .set("Cookie", adminCookie);

    expect(limited.status).toBe(200);
    expect(limited.body.notifications).toHaveLength(2);
    expect(limited.body.total).toBe(totalNotifications);
  });

  it("clamps absurdly large limits to a hard ceiling instead of materializing whatever is asked for", async () => {
    process.env.NODE_ENV = "development";

    const res = await request(app)
      .get("/api/admin/notifications?limit=999999")
      .set("Cookie", adminCookie);

    // The endpoint should still succeed (clamp, don't 400) so a polling SPA
    // with a stale config doesn't go dark — and it must not return more than
    // the hard ceiling worth of items even when far more were "requested".
    expect(res.status).toBe(200);
    expect(res.body.notifications.length).toBeLessThanOrEqual(200);
  });

  it("rejects a non-positive, non-numeric, or non-integer limit with 400", async () => {
    process.env.NODE_ENV = "development";

    // "1.5" and "10abc" are the trap cases — `parseInt` would silently
    // accept them as 1 / 10, which is a surprising truncation. Strict
    // integer parsing must 400 instead.
    for (const bad of ["0", "-5", "abc", "1.5", "10abc", " 5 "]) {
      const res = await request(app)
        .get(`/api/admin/notifications?limit=${encodeURIComponent(bad)}`)
        .set("Cookie", adminCookie);
      expect(res.status, `limit=${bad} should 400`).toBe(400);
    }
  });
});
