import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { db, auditLogTable, passwordResetAttemptsTable } from "@workspace/db";
import { and, eq, gte, desc } from "drizzle-orm";

const { redisGetMock, sortedSets } = vi.hoisted(() => {
  const sortedSets = new Map<string, Array<{ score: number; member: string }>>();

  function buildMulti() {
    const ops: Array<() => unknown> = [];
    const results: Array<[Error | null, unknown]> = [];
    const multi: any = {
      zremrangebyscore(key: string, _min: number, max: number) {
        ops.push(() => {
          const arr = sortedSets.get(key) || [];
          const kept = arr.filter((e) => e.score > max);
          sortedSets.set(key, kept);
          results.push([null, arr.length - kept.length]);
        });
        return multi;
      },
      zcard(key: string) {
        ops.push(() => {
          const arr = sortedSets.get(key) || [];
          results.push([null, arr.length]);
        });
        return multi;
      },
      zadd(key: string, score: number, member: string) {
        ops.push(() => {
          const arr = sortedSets.get(key) || [];
          arr.push({ score, member });
          sortedSets.set(key, arr);
          results.push([null, 1]);
        });
        return multi;
      },
      zremrangebyrank(key: string, start: number, stop: number) {
        ops.push(() => {
          const arr = sortedSets.get(key) || [];
          const sorted = [...arr].sort((a, b) => a.score - b.score);
          const len = sorted.length;
          const lo = start < 0 ? Math.max(0, len + start) : Math.min(start, len);
          const hi = stop < 0 ? len + stop : Math.min(stop, len - 1);
          if (lo > hi || len === 0) {
            results.push([null, 0]);
            return;
          }
          const toRemove = new Set(
            sorted.slice(lo, hi + 1).map((e) => e.member),
          );
          const kept = arr.filter((e) => !toRemove.has(e.member));
          sortedSets.set(key, kept);
          results.push([null, toRemove.size]);
        });
        return multi;
      },
      expire(_key: string, _seconds: number) {
        ops.push(() => {
          results.push([null, 1]);
        });
        return multi;
      },
      async exec() {
        for (const op of ops) op();
        return results;
      },
    };
    return multi;
  }

  const fakeRedis: any = {
    multi: buildMulti,
    async zrem(key: string, member: string) {
      const arr = sortedSets.get(key) || [];
      const next = arr.filter((e) => e.member !== member);
      sortedSets.set(key, next);
      return arr.length - next.length;
    },
  };

  const redisGetMock = vi.fn(() => fakeRedis);
  return { redisGetMock, sortedSets };
});

vi.mock("../lib/redis", () => ({
  getRedis: redisGetMock,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: vi.fn(async () => true),
}));

const {
  sendEmailNowMock,
  queueGHLSyncMock,
  emitWebhookEventMock,
} = vi.hoisted(() => ({
  sendEmailNowMock: vi.fn(async () => ({ success: true })),
  queueGHLSyncMock: vi.fn(async () => "job_test_id"),
  emitWebhookEventMock: vi.fn(async () => undefined),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: { sendEmailNow: sendEmailNowMock },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: queueGHLSyncMock,
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: emitWebhookEventMock,
  WEBHOOK_EVENT_TYPES: [],
}));

import { buildTestApp } from "./test-app";
import authRouter, {
  AUTH_RATE_LIMIT_AUDIT_ACTION,
  AUTH_RATE_LIMIT_AUDIT_ENTITY,
  processForgotPasswordRequest,
} from "../routes/auth";
import { __resetCaptchaWarningForTests } from "../middleware/captcha";

// Test app trusts X-Forwarded-For so we can simulate distinct client IPs in
// tests. Production app does NOT trust forwarded headers unless an operator
// explicitly configures `trust proxy`, so attackers can't spoof their IP.
let app: ReturnType<typeof buildTestApp>;
// Separate app instance with no trust-proxy so we can verify the spoofing
// guard: forged X-Forwarded-For must NOT change the rate-limit identity.
let untrustedApp: ReturnType<typeof buildTestApp>;
// Captured before any test runs so we can scope the audit-log cleanup to
// rows this file inserted, and so per-test queries can ignore older rows
// from other test files sharing the database.
let testRunStartedAt: Date;

beforeAll(() => {
  app = buildTestApp({ routers: [authRouter], trustProxy: true });
  untrustedApp = buildTestApp({ routers: [authRouter] });
  testRunStartedAt = new Date(Date.now() - 1000);
});

afterAll(async () => {
  // Every 429 in this file writes an audit-log row; remove them so we don't
  // pollute the shared test database.
  await db
    .delete(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION),
        gte(auditLogTable.createdAt, testRunStartedAt),
      ),
    );
  // The forgot-password audit-log test exercises the DB-backed rate limiter,
  // which inserts rows into password_reset_attempts. Clean those up too.
  await db
    .delete(passwordResetAttemptsTable)
    .where(gte(passwordResetAttemptsTable.createdAt, testRunStartedAt));
});

async function fetchAuditRows(endpoint: string) {
  return db
    .select()
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION),
        eq(auditLogTable.entityType, AUTH_RATE_LIMIT_AUDIT_ENTITY),
        eq(auditLogTable.entityId, endpoint),
        gte(auditLogTable.createdAt, testRunStartedAt),
      ),
    )
    .orderBy(desc(auditLogTable.createdAt));
}

beforeEach(async () => {
  sortedSets.clear();
  sendEmailNowMock.mockClear();
  redisGetMock.mockClear();
  // The forgot-password tests below write rows into password_reset_attempts
  // through the DB-backed limiter inside processForgotPasswordRequest. Sibling
  // tests reuse some of the same emails (e.g. "victim@example.test"), so
  // without per-test cleanup the per-email cap is already exhausted by the
  // time later tests run, causing 200-vs-429 mismatches. Scope to rows this
  // run inserted so we don't disturb anything else sharing the test DB.
  await db
    .delete(passwordResetAttemptsTable)
    .where(gte(passwordResetAttemptsTable.createdAt, testRunStartedAt));
});

describe("abuse-rate sorted-set growth cap", () => {
  it("never lets a single per-email register key grow past the per-route cap, even under sustained spam", async () => {
    // Hammer the same email far past its per-window budget (3). Even if
    // every request races past the count check, the per-key sorted set must
    // not balloon — the middleware applies a ZREMRANGEBYRANK cap on every
    // write so a single attacker can't grow one key without bound. 60 hits
    // is well past the 32-entry floor cap so any failure to trim shows up.
    for (let i = 0; i < 60; i++) {
      await request(app)
        .post("/api/auth/register")
        .set("X-Forwarded-For", `198.51.100.${(i % 250) + 1}`)
        .send({ email: "spam-victim", password: "Brandnew1!", name: "X" });
    }

    // Full key shape is `abuse-rate:{name}:{resolved}` and the resolver
    // already namespaces with the route prefix, so the per-email register
    // key starts with `abuse-rate:register:register:email:`.
    let largest = 0;
    for (const [key, entries] of sortedSets.entries()) {
      if (key.startsWith("abuse-rate:register:register:email:")) {
        largest = Math.max(largest, entries.length);
      }
    }
    // Cap is max(maxRequests * 4, 32). Per-email max is 3, floor wins → 32.
    expect(largest).toBeLessThanOrEqual(32);
    expect(largest).toBeGreaterThan(0);
  }, 60_000);

  it("never lets a single per-IP login key grow past the per-route cap", async () => {
    // Cap for /login is max(20 * 4, 32) = 80. 100 hits proves the cap holds.
    for (let i = 0; i < 100; i++) {
      await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.250")
        .send({ email: `scrape-${i}@example.test`, password: "WrongPass1!" });
    }

    const key = Array.from(sortedSets.keys()).find((k) =>
      k.startsWith("abuse-rate:login:login:ip:"),
    );
    expect(key).toBeDefined();
    const size = (sortedSets.get(key!) || []).length;
    expect(size).toBeLessThanOrEqual(80);
    expect(size).toBeGreaterThan(0);
  }, 60_000);
});

describe("POST /api/auth/forgot-password rate limiting", () => {
  it("allows up to 10 requests per IP per window, then 429s the 11th", async () => {
    // Vary the email each time so we don't trip the per-email limit (5).
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", "203.0.113.42")
        .send({ email: `someone-${i}@example.test` });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "203.0.113.42")
      .send({ email: "someone-11@example.test" });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
    // Generic phrasing — must not hint at whether the email exists.
    expect(blocked.body?.error?.message).not.toMatch(/exist/i);
    expect(blocked.body?.error?.message).not.toMatch(/found/i);
  });

  it("allows up to 5 requests per email per window, then 429s the 6th", async () => {
    // Vary IP so we don't trip the per-IP limit; per-email should still kick in.
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", `198.51.100.${i + 1}`)
        .send({ email: "victim@example.test" });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "198.51.100.99")
      .send({ email: "victim@example.test" });

    expect(blocked.status).toBe(429);
    expect(blocked.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("treats email casing/whitespace as the same key for the per-email limit", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", `192.0.2.${i + 1}`)
        .send({ email: "Victim@Example.Test" });
    }

    const blocked = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "192.0.2.99")
      .send({ email: "  victim@example.test  " });

    expect(blocked.status).toBe(429);
  });

  it("isolates limits between distinct IPs", async () => {
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", "203.0.113.10")
        .send({ email: `unique-${i}@example.test` });
    }

    // Different IP, different email — should not be blocked.
    const ok = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({ email: "fresh@example.test" });

    expect(ok.status).toBe(200);
  });
});

describe("POST /api/auth/register rate limiting", () => {
  it("allows up to 5 registrations per IP per window, then 429s the 6th", async () => {
    // Vary the email each time so we don't trip the per-email limit (3).
    // Use invalid email format so the handler 400s before touching the DB —
    // the rate-limit middleware still runs and counts the request.
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/auth/register")
        .set("X-Forwarded-For", "203.0.113.130")
        .send({ email: `not-an-email-${i}`, password: "Brandnew1!", name: "X" });
      expect(res.status).toBe(400);
    }

    const blocked = await request(app)
      .post("/api/auth/register")
      .set("X-Forwarded-For", "203.0.113.130")
      .send({ email: "not-an-email-final", password: "Brandnew1!", name: "X" });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
    // Generic phrasing — must not hint at whether the email is already
    // registered.
    expect(blocked.body?.error?.message).not.toMatch(/registered/i);
    expect(blocked.body?.error?.message).not.toMatch(/exist/i);
    expect(blocked.body?.error?.message).not.toMatch(/already/i);
  });

  it("allows up to 3 registrations per email per window, then 429s the 4th", async () => {
    // Vary IP so we don't trip the per-IP limit; per-email should still kick in.
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/auth/register")
        .set("X-Forwarded-For", `198.51.100.${100 + i}`)
        .send({ email: "not-an-email-victim", password: "Brandnew1!", name: "X" });
      expect(res.status).toBe(400);
    }

    const blocked = await request(app)
      .post("/api/auth/register")
      .set("X-Forwarded-For", "198.51.100.199")
      .send({ email: "not-an-email-victim", password: "Brandnew1!", name: "X" });

    expect(blocked.status).toBe(429);
    expect(blocked.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("normalizes email casing/whitespace for the per-email register limit", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/auth/register")
        .set("X-Forwarded-For", `192.0.2.${100 + i}`)
        .send({ email: "Bad-Email-Target", password: "Brandnew1!", name: "X" });
    }

    const blocked = await request(app)
      .post("/api/auth/register")
      .set("X-Forwarded-For", "192.0.2.199")
      .send({ email: "  bad-email-target  ", password: "Brandnew1!", name: "X" });

    expect(blocked.status).toBe(429);
  });

  it("isolates the register limit between distinct IPs", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/api/auth/register")
        .set("X-Forwarded-For", "203.0.113.140")
        .send({ email: `not-an-email-iso-${i}`, password: "Brandnew1!", name: "X" });
    }

    const ok = await request(app)
      .post("/api/auth/register")
      .set("X-Forwarded-For", "203.0.113.141")
      .send({ email: "not-an-email-fresh", password: "Brandnew1!", name: "X" });

    // Different IP, different email — should not be rate-limited (will be 400
    // from the email-format validator instead).
    expect(ok.status).toBe(400);
  });

  it("does not share limits between register and forgot-password", async () => {
    // Spend register's per-IP budget.
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/api/auth/register")
        .set("X-Forwarded-For", "203.0.113.150")
        .send({ email: `not-an-email-mix-${i}`, password: "Brandnew1!", name: "X" });
    }

    // Same IP hitting forgot-password should still be allowed.
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "203.0.113.150")
      .send({ email: "fresh-mix@example.test" });

    expect(res.status).toBe(200);
  });

  // Regression: the per-email register limiter once referenced an `emailKey`
  // symbol that wasn't a real key-resolver function, which crashed the auth
  // router on import and broke six test files. This test asserts the limiter
  // was constructed at module load (i.e. importing it did not throw) and is
  // configured with the documented per-email cap.
  it("constructs the per-email register limiter at module load (regression)", async () => {
    const auth = await import("../routes/auth");
    expect(typeof auth.registerEmailLimiter).toBe("function");
    expect(auth.REGISTER_EMAIL_LIMIT_MAX).toBe(3);
  });
});

describe("POST /api/auth/reset-password rate limiting", () => {
  it("allows up to 10 attempts per IP per window, then 429s the 11th", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post("/api/auth/reset-password")
        .set("X-Forwarded-For", "203.0.113.50")
        .send({ token: "a".repeat(64), password: "Brandnew1!" });
      // Token is invalid so we expect 400, but the rate-limit middleware ran.
      expect([400]).toContain(res.status);
    }

    const blocked = await request(app)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", "203.0.113.50")
      .send({ token: "b".repeat(64), password: "Brandnew1!" });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("isolates the reset-password limit between distinct IPs", async () => {
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post("/api/auth/reset-password")
        .set("X-Forwarded-For", "203.0.113.60")
        .send({ token: "c".repeat(64), password: "Brandnew1!" });
    }

    const ok = await request(app)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", "203.0.113.61")
      .send({ token: "d".repeat(64), password: "Brandnew1!" });

    // Different IP — should not be 429 (will be 400 because token is invalid).
    expect(ok.status).toBe(400);
  });

  it("ignores forged X-Forwarded-For headers when trust proxy is not configured", async () => {
    // Use the untrusted app (matches production: no trust proxy set).
    // Burn the per-IP budget on /reset-password from the real socket.
    for (let i = 0; i < 10; i++) {
      await request(untrustedApp)
        .post("/api/auth/reset-password")
        .send({ token: "f".repeat(64), password: "Brandnew1!" });
    }

    // An attacker varying X-Forwarded-For each request must NOT bypass the
    // limit — the middleware should fall back to the real socket address.
    const blocked = await request(untrustedApp)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", "10.0.0.1")
      .send({ token: "g".repeat(64), password: "Brandnew1!" });

    expect(blocked.status).toBe(429);
    expect(blocked.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");

    const stillBlocked = await request(untrustedApp)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", "10.0.0.2, 10.0.0.3")
      .send({ token: "h".repeat(64), password: "Brandnew1!" });

    expect(stillBlocked.status).toBe(429);
  });

  it("does not share limits between register and reset-password", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/api/auth/register")
        .set("X-Forwarded-For", "203.0.113.80")
        .send({ email: `not-an-email-${i}`, password: "Brandnew1!", name: "X" });
    }

    const res = await request(app)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", "203.0.113.80")
      .send({ token: "z".repeat(64), password: "Brandnew1!" });

    expect(res.status).toBe(400);
  });

  it("does not share limits between forgot-password and reset-password", async () => {
    // Spend forgot-password's per-IP budget.
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", "203.0.113.70")
        .send({ email: `u-${i}@example.test` });
    }

    // Same IP hitting reset-password should still be allowed.
    const res = await request(app)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", "203.0.113.70")
      .send({ token: "e".repeat(64), password: "Brandnew1!" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login rate limiting", () => {
  it("allows up to 20 attempts per IP per window, then 429s the 21st", async () => {
    // Vary email each request so the per-account 5-strike lockout never fires
    // — we want to prove the per-IP cap kicks in across distinct accounts
    // (i.e. credential stuffing).
    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.80")
        .send({ email: `cs-${i}@example.test`, password: "WrongPass1!" });
      // Invalid credentials path — expect 401, but the limiter ran first.
      expect(res.status).toBe(401);
    }

    const blocked = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.80")
      .send({ email: "cs-21@example.test", password: "WrongPass1!" });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
    // Generic phrasing — must not reveal whether the email exists.
    expect(blocked.body?.error?.message).not.toMatch(/exist/i);
    expect(blocked.body?.error?.message).not.toMatch(/found/i);
    expect(blocked.body?.error?.message).not.toMatch(/email/i);
  });

  it("isolates the login limit between distinct IPs", async () => {
    for (let i = 0; i < 20; i++) {
      await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.90")
        .send({ email: `iso-${i}@example.test`, password: "WrongPass1!" });
    }

    const ok = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.91")
      .send({ email: "iso-fresh@example.test", password: "WrongPass1!" });

    // Different IP — rate limit shouldn't fire; falls through to 401.
    expect(ok.status).toBe(401);
  });

  it("ignores forged X-Forwarded-For headers when trust proxy is not configured", async () => {
    // Burn the per-IP budget on /login from the real socket.
    for (let i = 0; i < 20; i++) {
      await request(untrustedApp)
        .post("/api/auth/login")
        .send({ email: `spoof-${i}@example.test`, password: "WrongPass1!" });
    }

    // Attacker rotating X-Forwarded-For each request must NOT bypass the cap.
    const blocked = await request(untrustedApp)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "10.0.0.1")
      .send({ email: "spoof-21@example.test", password: "WrongPass1!" });

    expect(blocked.status).toBe(429);
    expect(blocked.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("does not share limits between login and forgot-password", async () => {
    for (let i = 0; i < 20; i++) {
      await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.95")
        .send({ email: `mix-${i}@example.test`, password: "WrongPass1!" });
    }

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "203.0.113.95")
      .send({ email: "mix-fp@example.test" });

    expect(res.status).toBe(200);
  });
});

describe("Rate limiter short-circuits before captcha verification", () => {
  // The middleware order on /auth/{login,register,forgot-password} is
  // intentional: rate limiter runs BEFORE verifyCaptcha(). That way a 429
  // never burns a Cloudflare siteverify call (which would (a) consume the
  // user's single-use token and (b) hit Turnstile's API on every blocked
  // request under attack). These tests lock in that contract by enabling
  // the captcha and asserting we never call siteverify on a 429.
  const realFetch = global.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    __resetCaptchaWarningForTests();
    process.env.TURNSTILE_SECRET_KEY = "test-secret-rate-limit-order";
    fetchMock.mockReset();
    // Resolve with a fresh Response on every call — Response bodies are
    // single-read, so reusing one instance across calls would make the
    // captcha middleware fail with "Body has already been read" instead of
    // verifying successfully.
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = realFetch;
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it("does not call Cloudflare siteverify on a 429 from /auth/login", async () => {
    const ip = "203.0.113.231";

    // Burn the per-IP login budget (20). Each pre-cap request has a valid
    // captcha token, so siteverify is called once per request.
    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", ip)
        .send({
          email: `cap-${i}@example.test`,
          password: "WrongPass1!",
          captchaToken: "good-token",
        });
      expect(res.status).toBe(401);
    }
    expect(fetchMock).toHaveBeenCalledTimes(20);

    fetchMock.mockClear();
    const blocked = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", ip)
      .send({
        email: "cap-21@example.test",
        password: "WrongPass1!",
        captchaToken: "good-token",
      });

    expect(blocked.status).toBe(429);
    expect(blocked.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
    // The whole point: a request we're about to 429 must NOT trigger an
    // outbound call to Cloudflare's siteverify endpoint.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call Cloudflare siteverify on a 429 from /auth/register", async () => {
    const ip = "203.0.113.232";

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/auth/register")
        .set("X-Forwarded-For", ip)
        .send({
          email: `cap-reg-${i}`,
          password: "Brandnew1!",
          name: "X",
          captchaToken: "good-token",
        });
      // 400 from email-format validator after captcha verifies.
      expect(res.status).toBe(400);
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);

    fetchMock.mockClear();
    const blocked = await request(app)
      .post("/api/auth/register")
      .set("X-Forwarded-For", ip)
      .send({
        email: "cap-reg-final",
        password: "Brandnew1!",
        name: "X",
        captchaToken: "good-token",
      });

    expect(blocked.status).toBe(429);
    expect(blocked.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call Cloudflare siteverify on a 429 from /auth/forgot-password", async () => {
    const ip = "203.0.113.233";

    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", ip)
        .send({
          email: `cap-fp-${i}@example.test`,
          captchaToken: "good-token",
        });
      expect(res.status).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(10);

    fetchMock.mockClear();
    const blocked = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", ip)
      .send({
        email: "cap-fp-11@example.test",
        captchaToken: "good-token",
      });

    expect(blocked.status).toBe(429);
    expect(blocked.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Auth rate-limit hits write to the audit log", () => {
  it("a burst of failed logins past the per-IP cap writes one audit row per blocked attempt", async () => {
    const ip = "203.0.113.200";

    // Burn the per-IP budget across distinct emails — none of these should
    // produce an audit row because they're under the cap.
    for (let i = 0; i < 20; i++) {
      const ok = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", ip)
        .send({ email: `audit-cs-${i}@example.test`, password: "WrongPass1!" });
      expect(ok.status).toBe(401);
    }

    const beforeBlocks = await fetchAuditRows("login");
    const blockedFromThisIp = beforeBlocks.filter(
      (r) => (r.metadata as any)?.ip === ip,
    );
    expect(blockedFromThisIp).toHaveLength(0);

    // Two more attempts that get 429-d — each should produce its own row.
    const blocked1 = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", ip)
      .send({ email: "AuditTarget@Example.Test", password: "WrongPass1!" });
    expect(blocked1.status).toBe(429);

    const blocked2 = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", ip)
      .send({ email: "another-target@example.test", password: "WrongPass1!" });
    expect(blocked2.status).toBe(429);

    const rows = await fetchAuditRows("login");
    const fromThisIp = rows.filter((r) => (r.metadata as any)?.ip === ip);
    expect(fromThisIp).toHaveLength(2);

    const emails = fromThisIp.map((r) => (r.metadata as any)?.email).sort();
    expect(emails).toEqual([
      "another-target@example.test",
      "audittarget@example.test", // normalized to lowercase
    ]);

    for (const row of fromThisIp) {
      expect(row.ipAddress).toBe(ip);
      expect(row.description).toContain(ip);
      expect(row.description).toContain("/api/auth/login");
      expect((row.metadata as any)?.endpoint).toBe("login");
    }
  });

  it("writes an audit row when /auth/reset-password is rate-limited (no email available)", async () => {
    const ip = "203.0.113.210";

    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post("/api/auth/reset-password")
        .set("X-Forwarded-For", ip)
        .send({ token: "k".repeat(64), password: "Brandnew1!" });
      expect(res.status).toBe(400);
    }

    const blocked = await request(app)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", ip)
      .send({ token: "l".repeat(64), password: "Brandnew1!" });
    expect(blocked.status).toBe(429);

    const rows = await fetchAuditRows("reset-password");
    const fromThisIp = rows.filter((r) => (r.metadata as any)?.ip === ip);
    expect(fromThisIp).toHaveLength(1);
    const [row] = fromThisIp;
    expect(row.ipAddress).toBe(ip);
    expect(row.description).toContain("/api/auth/reset-password");
    // No request-body email on this endpoint, so no target email captured.
    expect((row.metadata as any)?.email).toBeNull();
    expect(row.actorEmail).toBeNull();
  });

  it("writes an audit row when /auth/forgot-password is suppressed by its DB-backed rate limit", async () => {
    // /auth/forgot-password doesn't use abuseRateLimit; its cap is enforced
    // inside processForgotPasswordRequest against the password_reset_attempts
    // table. Drive the helper directly so we don't have to spin up Redis or
    // worry about response shaping, and trip the per-email hourly limit (3)
    // by calling it 4 times with the same email + IP.
    const sentinelIp = "203.0.113.220";
    const sentinelEmail = `audit-suppressed-${Date.now()}@example.test`;

    for (let i = 0; i < 3; i++) {
      await processForgotPasswordRequest(sentinelEmail, sentinelIp);
    }
    // The 4th call exceeds the per-email hourly limit and should write an
    // audit-log row from the suppression branch.
    await processForgotPasswordRequest(sentinelEmail, sentinelIp);

    const rows = await fetchAuditRows("forgot-password");
    const fromThisRequest = rows.filter(
      (r) => (r.metadata as any)?.email === sentinelEmail,
    );
    expect(fromThisRequest.length).toBeGreaterThanOrEqual(1);
    const [row] = fromThisRequest;
    expect((row.metadata as any)?.ip).toBe(sentinelIp);
    expect((row.metadata as any)?.endpoint).toBe("forgot-password");
    expect(row.actorEmail).toBe(sentinelEmail);
    expect(row.description).toContain("/api/auth/forgot-password");
    expect(row.description).toContain(sentinelEmail);
  });
});
