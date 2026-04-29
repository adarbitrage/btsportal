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

  it("includes an auditLogRetention.policies array covering every audit-log retention sweep", async () => {
    const { runQueueFallbackAuditCleanup } = await import("../lib/queue-fallback-audit-cleanup");
    const { runAuthRateLimitAuditCleanup } = await import("../lib/auth-rate-limit-audit-cleanup");
    const { runAuditLogRetention, RETENTION_POLICIES } = await import("../lib/audit-log-retention");

    // Force each sweep to record a successful run so the response carries
    // realistic last-run timestamps and per-policy deletion counts.
    await runQueueFallbackAuditCleanup();
    await runAuthRateLimitAuditCleanup();
    await runAuditLogRetention();

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const auditLogRetention = res.body?.services?.auditLogRetention;
    expect(auditLogRetention).toBeTruthy();
    expect(Array.isArray(auditLogRetention.policies)).toBe(true);

    // queue_fallback + auth_rate_limit_blocked + every entry in
    // RETENTION_POLICIES — one row per policy, no duplicates, stable order.
    expect(auditLogRetention.policies.length).toBe(2 + RETENTION_POLICIES.length);

    const labels = auditLogRetention.policies.map((p: { label: string }) => p.label);
    expect(labels).toContain("queue_fallback");
    expect(labels).toContain("auth_rate_limit_blocked");
    for (const policy of RETENTION_POLICIES) {
      expect(labels).toContain(policy.label);
    }

    for (const policy of auditLogRetention.policies) {
      expect(typeof policy.label).toBe("string");
      expect(Array.isArray(policy.actionTypes)).toBe(true);
      expect(policy.actionTypes.length).toBeGreaterThan(0);
      expect(typeof policy.retentionDays).toBe("number");
      expect(policy.retentionDays).toBeGreaterThan(0);
      expect(policy).toHaveProperty("lastRanAt");
      expect(policy).toHaveProperty("lastDeletedCount");
      expect(policy).toHaveProperty("lastError");
      // After the explicit run() calls above every policy must have a
      // non-null heartbeat. This catches a regression where the retention
      // module forgets to update its tracking state.
      expect(typeof policy.lastRanAt).toBe("string");
      expect(typeof policy.lastDeletedCount).toBe("number");
      expect(policy.lastError).toBeNull();
    }
  });

  it("surfaces a per-policy lastError when an audit-log retention sweep fails", async () => {
    const {
      __resetAuditLogRetentionStateForTests,
      getAuditLogRetentionStatus,
      RETENTION_POLICIES,
    } = await import("../lib/audit-log-retention");
    __resetAuditLogRetentionStateForTests();

    // Drive a synthetic failure through the same code path the sweep uses
    // by spying on db.delete and forcing it to throw, then call the sweep
    // and assert the per-policy lastError is set and surfaces in the
    // System Health response.
    const dbModule = await import("@workspace/db");
    const failureMessage = "synthetic-retention-failure";
    const spy = vi.spyOn(dbModule.db, "delete").mockImplementation(() => {
      throw new Error(failureMessage);
    });

    try {
      const { runAuditLogRetention } = await import("../lib/audit-log-retention");
      await runAuditLogRetention();
    } finally {
      spy.mockRestore();
    }

    const status = getAuditLogRetentionStatus();
    for (const policy of RETENTION_POLICIES) {
      const entry = status.find((s) => s.label === policy.label);
      expect(entry, `expected status entry for ${policy.label}`).toBeDefined();
      expect(entry!.lastError).not.toBeNull();
      expect(entry!.lastError!.message).toBe(failureMessage);
    }

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const responsePolicies = res.body?.services?.auditLogRetention?.policies as Array<{ label: string; lastError: { at: string; message: string } | null }>;
    for (const policy of RETENTION_POLICIES) {
      const entry = responsePolicies.find((p) => p.label === policy.label);
      expect(entry).toBeDefined();
      expect(entry!.lastError).not.toBeNull();
      expect(entry!.lastError!.message).toBe(failureMessage);
    }

    __resetAuditLogRetentionStateForTests();
  });

  it("includes an emailChangeAttemptsCleanup status field", async () => {
    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ecc = res.body?.services?.emailChangeAttemptsCleanup;
    expect(ecc).toBeTruthy();
    expect(typeof ecc.intervalMs).toBe("number");
    expect(ecc.intervalMs).toBeGreaterThan(0);
    expect(typeof ecc.stale).toBe("boolean");
    // lastRanAt and lastDeletedCount may be null before any sweep has run;
    // both shapes are valid as long as the keys are present.
    expect(ecc).toHaveProperty("lastRanAt");
    expect(ecc).toHaveProperty("lastDeletedCount");
    expect(ecc).toHaveProperty("lastError");
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
    expect(Array.isArray(arl.recentRuns)).toBe(true);
  });

  it("returns an empty missingCriticalSecrets list outside production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    delete (process.env as Record<string, string | undefined>).NODE_ENV;

    try {
      const res = await request(app)
        .get("/api/admin/system/health")
        .set("Cookie", adminCookie);

      expect(res.status).toBe(200);
      expect(res.body?.services?.missingCriticalSecrets).toEqual([]);
    } finally {
      if (originalNodeEnv === undefined) {
        delete (process.env as Record<string, string | undefined>).NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });

  it("lists every misconfigured guarded secret in production", async () => {
    const { GUARDED_SECRETS } = await import("../lib/production-env-guard");
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEnv: Record<string, string | undefined> = {};
    for (const s of GUARDED_SECRETS) {
      originalEnv[s.envVar] = process.env[s.envVar];
      delete (process.env as Record<string, string | undefined>)[s.envVar];
    }
    process.env.NODE_ENV = "production";

    try {
      const res = await request(app)
        .get("/api/admin/system/health")
        .set("Cookie", adminCookie);

      expect(res.status).toBe(200);
      const list = res.body?.services?.missingCriticalSecrets;
      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(GUARDED_SECRETS.length);
      const expected = GUARDED_SECRETS.map((s) => ({
        id: s.id,
        envVar: s.envVar,
        title: s.title,
        message: s.message,
        state: "unset",
      }));
      expect(list).toEqual(expected);
    } finally {
      if (originalNodeEnv === undefined) {
        delete (process.env as Record<string, string | undefined>).NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      for (const s of GUARDED_SECRETS) {
        const v = originalEnv[s.envVar];
        if (v === undefined) {
          delete (process.env as Record<string, string | undefined>)[s.envVar];
        } else {
          process.env[s.envVar] = v;
        }
      }
    }
  });

  it("distinguishes 'unset' from 'defaulted' on each missing secret in production", async () => {
    const { GUARDED_SECRETS } = await import("../lib/production-env-guard");
    const jwt = GUARDED_SECRETS.find((s) => s.envVar === "JWT_SECRET")!;
    const session = GUARDED_SECRETS.find((s) => s.envVar === "SESSION_SECRET")!;
    const sendgrid = GUARDED_SECRETS.find((s) => s.envVar === "SENDGRID_API_KEY")!;
    expect(jwt.defaultedValues?.length ?? 0).toBeGreaterThan(0);

    const originalNodeEnv = process.env.NODE_ENV;
    const originalEnv: Record<string, string | undefined> = {};
    for (const s of GUARDED_SECRETS) {
      originalEnv[s.envVar] = process.env[s.envVar];
    }

    // JWT_SECRET pinned to a known placeholder ⇒ "defaulted".
    process.env.JWT_SECRET = jwt.defaultedValues![0];
    // SESSION_SECRET wiped ⇒ "unset".
    delete (process.env as Record<string, string | undefined>).SESSION_SECRET;
    // SENDGRID_API_KEY whitespace ⇒ also "unset" (treated like wiped).
    process.env.SENDGRID_API_KEY = "   ";
    process.env.NODE_ENV = "production";

    try {
      const res = await request(app)
        .get("/api/admin/system/health")
        .set("Cookie", adminCookie);

      expect(res.status).toBe(200);
      const list = res.body?.services?.missingCriticalSecrets as Array<{
        id: string;
        envVar: string;
        state: string;
      }>;
      const byVar = Object.fromEntries(list.map((s) => [s.envVar, s.state]));
      expect(byVar[jwt.envVar]).toBe("defaulted");
      expect(byVar[session.envVar]).toBe("unset");
      expect(byVar[sendgrid.envVar]).toBe("unset");

      // Defense in depth: the runtime env-var value itself is never
      // serialized back. The descriptor `message` is allowed to mention
      // the literal placeholder as static help text (it is in source
      // control), but the response object must not carry the live value
      // under any other field — so the per-secret payload exposes only
      // the documented fields.
      const documentedFields = ["id", "envVar", "title", "message", "state"].sort();
      for (const entry of list) {
        expect(Object.keys(entry).sort()).toEqual(documentedFields);
      }
    } finally {
      if (originalNodeEnv === undefined) {
        delete (process.env as Record<string, string | undefined>).NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      for (const s of GUARDED_SECRETS) {
        const v = originalEnv[s.envVar];
        if (v === undefined) {
          delete (process.env as Record<string, string | undefined>)[s.envVar];
        } else {
          process.env[s.envVar] = v;
        }
      }
    }
  });

  it("omits secrets that are configured from missingCriticalSecrets in production", async () => {
    const { GUARDED_SECRETS } = await import("../lib/production-env-guard");
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEnv: Record<string, string | undefined> = {};
    for (const s of GUARDED_SECRETS) {
      originalEnv[s.envVar] = process.env[s.envVar];
      process.env[s.envVar] = `real-${s.envVar.toLowerCase()}-value`;
    }
    process.env.NODE_ENV = "production";

    try {
      const res = await request(app)
        .get("/api/admin/system/health")
        .set("Cookie", adminCookie);

      expect(res.status).toBe(200);
      expect(res.body?.services?.missingCriticalSecrets).toEqual([]);
    } finally {
      if (originalNodeEnv === undefined) {
        delete (process.env as Record<string, string | undefined>).NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      for (const s of GUARDED_SECRETS) {
        const v = originalEnv[s.envVar];
        if (v === undefined) {
          delete (process.env as Record<string, string | undefined>)[s.envVar];
        } else {
          process.env[s.envVar] = v;
        }
      }
    }
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
