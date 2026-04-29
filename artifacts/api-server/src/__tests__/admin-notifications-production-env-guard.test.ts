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
  type DeliveryResult,
  type ProductionEnvGuardAlertPayload,
} from "../lib/production-env-guard";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `notif-envguard-${randomUUID().slice(0, 8)}`;

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

  for (const k of [...ALL_GUARDED_ENV_VARS, "NODE_ENV"]) {
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
}

beforeEach(() => {
  __resetProductionEnvGuardForTests();
  configureAllSecrets();
});

afterEach(() => {
  __setProductionEnvGuardDeliveriesForTests(null);
  for (const [k, v] of Object.entries(originalEnvSnapshot)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
});

function makeStubs() {
  const calls: Record<string, ProductionEnvGuardAlertPayload[]> = {
    pagerduty: [],
    email: [],
    slack: [],
  };
  __setProductionEnvGuardDeliveriesForTests({
    pagerduty: async (p): Promise<DeliveryResult> => {
      calls.pagerduty.push(p);
      return { channel: "pagerduty", secretId: p.secret.id, ok: true };
    },
    email: async (p): Promise<DeliveryResult> => {
      calls.email.push(p);
      return { channel: "email", secretId: p.secret.id, ok: true };
    },
    slack: async (p): Promise<DeliveryResult> => {
      calls.slack.push(p);
      return { channel: "slack", secretId: p.secret.id, ok: true };
    },
  });
  return calls;
}

describe("GET /api/admin/notifications — production env guard", () => {
  it("emits a high-severity notification per missing critical secret in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    delete process.env.SESSION_SECRET;
    makeStubs();

    const res = await request(app)
      .get("/api/admin/notifications")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const items = res.body.filter(
      (n: any) => n.type === "production_env_secret_missing",
    );
    const ids = items.map((n: any) => n.id).sort();
    expect(ids).toEqual(
      ["jwt-secret-missing", "session-secret-missing"].sort(),
    );
    for (const n of items) {
      expect(n.severity).toBe("high");
      expect(n.link).toBe("/admin/system");
      expect(typeof n.title).toBe("string");
      expect(n.title.length).toBeGreaterThan(0);
      expect(typeof n.message).toBe("string");
    }
  });

  it("treats JWT_SECRET=dev-secret-change-me as missing in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "dev-secret-change-me";
    makeStubs();

    const res = await request(app)
      .get("/api/admin/notifications")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(
      res.body.some((n: any) => n.id === "jwt-secret-missing"),
    ).toBe(true);
  });

  it("does not emit env-guard notifications outside production even if secrets are missing", async () => {
    process.env.NODE_ENV = "development";
    for (const s of GUARDED_SECRETS) delete process.env[s.envVar];
    makeStubs();

    const res = await request(app)
      .get("/api/admin/notifications")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(
      res.body.some(
        (n: any) => n.type === "production_env_secret_missing",
      ),
    ).toBe(false);
  });

  it("does not emit env-guard notifications in production when all secrets are configured", async () => {
    process.env.NODE_ENV = "production";
    configureAllSecrets();
    makeStubs();

    const res = await request(app)
      .get("/api/admin/notifications")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(
      res.body.some(
        (n: any) => n.type === "production_env_secret_missing",
      ),
    ).toBe(false);
  });

  it("fans out to on-call exactly once per channel per missing secret across rapid repeat polls", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    delete process.env.SENDGRID_API_KEY;
    const calls = makeStubs();

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .get("/api/admin/notifications")
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);
    }

    // Allow the fire-and-forget alerter dispatches kicked off above to settle.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const expectedSecretIds = [
      "jwt-secret-missing",
      "sendgrid-api-key-missing",
    ].sort();
    expect(calls.pagerduty.map((c) => c.secret.id).sort()).toEqual(
      expectedSecretIds,
    );
    expect(calls.email.map((c) => c.secret.id).sort()).toEqual(
      expectedSecretIds,
    );
    expect(calls.slack.map((c) => c.secret.id).sort()).toEqual(
      expectedSecretIds,
    );
    for (const ch of [calls.pagerduty, calls.email, calls.slack]) {
      for (const c of ch) {
        expect(c.kind).toBe("fire");
      }
    }
  });
});
