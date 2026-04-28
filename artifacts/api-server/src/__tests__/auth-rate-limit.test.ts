import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";

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
import authRouter from "../routes/auth";

// Test app trusts X-Forwarded-For so we can simulate distinct client IPs in
// tests. Production app does NOT trust forwarded headers unless an operator
// explicitly configures `trust proxy`, so attackers can't spoof their IP.
let app: ReturnType<typeof buildTestApp>;
// Separate app instance with no trust-proxy so we can verify the spoofing
// guard: forged X-Forwarded-For must NOT change the rate-limit identity.
let untrustedApp: ReturnType<typeof buildTestApp>;

beforeAll(() => {
  app = buildTestApp({ routers: [authRouter], trustProxy: true });
  untrustedApp = buildTestApp({ routers: [authRouter] });
});

beforeEach(() => {
  sortedSets.clear();
  sendEmailNowMock.mockClear();
  redisGetMock.mockClear();
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
