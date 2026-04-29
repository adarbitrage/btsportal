import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

// In-memory fake Redis. Only implements what auth.ts uses: SET with EX/NX
// semantics for the signup_attempted throttle, plus the multi() pipeline
// shape consumed by abuseRateLimit (which we stub below anyway, but the
// shape stays here so a future refactor that drops the middleware stub
// won't crash on a missing method).
const { fakeRedis, redisStore } = vi.hoisted(() => {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  function isExpired(entry: { expiresAt: number | null }): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }

  const redis: any = {
    async set(key: string, value: string, ...args: unknown[]) {
      // Parse the variadic options — auth.ts calls `set(key, "1", "EX", N, "NX")`.
      let ex: number | null = null;
      let nx = false;
      for (let i = 0; i < args.length; i++) {
        const token = args[i];
        if (typeof token === "string" && token.toUpperCase() === "EX") {
          ex = Number(args[++i]);
        } else if (typeof token === "string" && token.toUpperCase() === "NX") {
          nx = true;
        }
      }
      const existing = store.get(key);
      if (existing && !isExpired(existing) && nx) return null;
      store.set(key, {
        value,
        expiresAt: ex !== null ? Date.now() + ex * 1000 : null,
      });
      return "OK";
    },
    async del(key: string) {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    },
  };

  return { fakeRedis: redis, redisStore: store };
});

vi.mock("../lib/redis", () => ({
  getRedis: () => fakeRedis,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: vi.fn(async () => true),
}));

const { sendEmailNowMock, emitWebhookEventMock, queueGHLSyncMock } = vi.hoisted(
  () => ({
    sendEmailNowMock: vi.fn(async () => ({ success: true })),
    emitWebhookEventMock: vi.fn(async () => undefined),
    queueGHLSyncMock: vi.fn(async () => "job_test_id"),
  }),
);

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

// We're testing the throttle inside processRegisterRequest, not the
// per-IP/per-email register limiters. Stub the middleware so 5 attempts
// against the same email don't hit the abuse-rate cap of 3.
vi.mock("../middleware/abuse-rate-limit", () => {
  const passthrough =
    () => (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    abuseRateLimit: passthrough,
    ipKey: () => () => null,
    emailKey: () => () => null,
  };
});

import { buildTestApp } from "./test-app";
import authRouter, { processRegisterRequest } from "../routes/auth";

const TEST_TAG = `signup-throttle-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;

async function seedExistingUser(suffix: string) {
  const email = `${TEST_TAG}-${suffix}@example.test`.toLowerCase();
  const passwordHash = await bcrypt.hash("ExistingPass1!", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      name: `Existing ${suffix}`,
      email,
      passwordHash,
      role: "member",
      emailVerified: true,
    })
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
    });
  seededUserIds.push(row.id);
  return row;
}

beforeAll(() => {
  app = buildTestApp({ routers: [authRouter] });
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  sendEmailNowMock.mockClear();
  emitWebhookEventMock.mockClear();
  queueGHLSyncMock.mockClear();
  redisStore.clear();
});

describe("processRegisterRequest — signup_attempted throttle", () => {
  it("sends only one signup_attempted email even after 5 attempts within the window", async () => {
    const existing = await seedExistingUser("burst");

    for (let i = 0; i < 5; i++) {
      await processRegisterRequest({
        email: existing.email,
        password: "Whatever1!",
        name: "Imp",
      });
    }

    const noticeCalls = sendEmailNowMock.mock.calls.filter(
      (c: any[]) =>
        c[0]?.templateSlug === "signup_attempted" && c[0]?.to === existing.email,
    ) as any[][];
    expect(noticeCalls).toHaveLength(1);
    expect(noticeCalls[0]?.[0]?.userId).toBe(existing.id);
    expect(noticeCalls[0]?.[0]?.variables?.member_name).toBe(existing.name);
  });

  it("normalizes the throttle key by email casing, so case variants share the cap", async () => {
    const existing = await seedExistingUser("casing");

    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
    });
    await processRegisterRequest({
      email: existing.email.toUpperCase(),
      password: "Whatever1!",
      name: "Imp",
    });
    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
    });

    const noticeCalls = sendEmailNowMock.mock.calls.filter(
      (c: any[]) => c[0]?.templateSlug === "signup_attempted",
    );
    expect(noticeCalls).toHaveLength(1);
  });

  it("throttles each recipient independently — different emails each get their own notice", async () => {
    const a = await seedExistingUser("multi-a");
    const b = await seedExistingUser("multi-b");

    await processRegisterRequest({
      email: a.email,
      password: "Whatever1!",
      name: "Imp",
    });
    await processRegisterRequest({
      email: a.email,
      password: "Whatever1!",
      name: "Imp",
    });
    await processRegisterRequest({
      email: b.email,
      password: "Whatever1!",
      name: "Imp",
    });
    await processRegisterRequest({
      email: b.email,
      password: "Whatever1!",
      name: "Imp",
    });

    const callsToA = sendEmailNowMock.mock.calls.filter(
      (c: any[]) =>
        c[0]?.templateSlug === "signup_attempted" && c[0]?.to === a.email,
    );
    const callsToB = sendEmailNowMock.mock.calls.filter(
      (c: any[]) =>
        c[0]?.templateSlug === "signup_attempted" && c[0]?.to === b.email,
    );
    expect(callsToA).toHaveLength(1);
    expect(callsToB).toHaveLength(1);
  });

  it("allows a new notice once the throttle key has expired (simulated via store eviction)", async () => {
    const existing = await seedExistingUser("expiry");

    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
    });

    // Simulate the 24h TTL elapsing by clearing the throttle key. We don't
    // wait real wall-clock time, but we want to verify that once the key is
    // gone the next attempt sends again — i.e. the throttle is genuinely
    // time-bounded rather than a permanent block.
    redisStore.clear();

    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
    });

    const noticeCalls = sendEmailNowMock.mock.calls.filter(
      (c: any[]) =>
        c[0]?.templateSlug === "signup_attempted" && c[0]?.to === existing.email,
    );
    expect(noticeCalls).toHaveLength(2);
  });

  it("honors SIGNUP_ATTEMPTED_NOTICE_WINDOW_SEC when sizing the throttle window in Redis", async () => {
    const existing = await seedExistingUser("env-window");

    const prev = process.env.SIGNUP_ATTEMPTED_NOTICE_WINDOW_SEC;
    process.env.SIGNUP_ATTEMPTED_NOTICE_WINDOW_SEC = String(2 * 60 * 60); // 2h
    try {
      await processRegisterRequest({
        email: existing.email,
        password: "Whatever1!",
        name: "Imp",
      });
    } finally {
      if (prev === undefined) {
        delete process.env.SIGNUP_ATTEMPTED_NOTICE_WINDOW_SEC;
      } else {
        process.env.SIGNUP_ATTEMPTED_NOTICE_WINDOW_SEC = prev;
      }
    }

    // Find the throttle key written for this email and verify the TTL the
    // route asked Redis to apply matches the env override (within a small
    // tolerance for whatever default our fake Redis uses).
    const keys = Array.from(redisStore.keys()).filter((k) =>
      k.startsWith("auth:signup-attempted-notice:"),
    );
    expect(keys).toHaveLength(1);
    const entry = redisStore.get(keys[0]);
    expect(entry?.expiresAt).toBeGreaterThan(Date.now());
    const ttlMs = (entry?.expiresAt ?? 0) - Date.now();
    // 2h = 7,200,000ms; allow a healthy slop for test scheduling jitter.
    expect(ttlMs).toBeGreaterThan(2 * 60 * 60 * 1000 - 5_000);
    expect(ttlMs).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
  });

  it("clamps SIGNUP_ATTEMPTED_NOTICE_WINDOW_SEC up to a 1h floor when set absurdly low", async () => {
    const existing = await seedExistingUser("env-floor");

    const prev = process.env.SIGNUP_ATTEMPTED_NOTICE_WINDOW_SEC;
    process.env.SIGNUP_ATTEMPTED_NOTICE_WINDOW_SEC = "1"; // 1 second — way below floor
    try {
      await processRegisterRequest({
        email: existing.email,
        password: "Whatever1!",
        name: "Imp",
      });
    } finally {
      if (prev === undefined) {
        delete process.env.SIGNUP_ATTEMPTED_NOTICE_WINDOW_SEC;
      } else {
        process.env.SIGNUP_ATTEMPTED_NOTICE_WINDOW_SEC = prev;
      }
    }

    const keys = Array.from(redisStore.keys()).filter((k) =>
      k.startsWith("auth:signup-attempted-notice:"),
    );
    expect(keys).toHaveLength(1);
    const ttlMs = (redisStore.get(keys[0])?.expiresAt ?? 0) - Date.now();
    // Floor is 1h = 3,600,000ms; the env value of 1s must NOT have been used.
    expect(ttlMs).toBeGreaterThan(60 * 60 * 1000 - 5_000);
  });

  it("falls through and allows the send when Redis is unavailable so a real account-takeover signal isn't silently dropped", async () => {
    const existing = await seedExistingUser("redis-down");

    // Temporarily simulate Redis being offline for two consecutive attempts.
    // We swap in a redis whose .set always rejects to model a connection
    // failure path; the helper catches and returns true (allow).
    const originalSet = fakeRedis.set;
    fakeRedis.set = async () => {
      throw new Error("simulated redis outage");
    };
    try {
      await processRegisterRequest({
        email: existing.email,
        password: "Whatever1!",
        name: "Imp",
      });
      await processRegisterRequest({
        email: existing.email,
        password: "Whatever1!",
        name: "Imp",
      });
    } finally {
      fakeRedis.set = originalSet;
    }

    const noticeCalls = sendEmailNowMock.mock.calls.filter(
      (c: any[]) =>
        c[0]?.templateSlug === "signup_attempted" && c[0]?.to === existing.email,
    );
    // Both attempts sent — degraded mode is permissive by design (matches
    // the email-change-hint helper in the same file). The per-IP/per-email
    // abuse-rate-limit middleware in front of /auth/register still bounds
    // how many of these an attacker can trigger when Redis is healthy.
    expect(noticeCalls.length).toBe(2);
  });

  it("the route handler dispatches at most one notice per window for a given victim", async () => {
    const existing = await seedExistingUser("route");

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ email: existing.email, password: "Whatever1!", name: "Imp" });
      expect(res.status).toBe(200);
    }

    // The route runs the worker fire-and-forget, so we need to wait for the
    // dispatched work to settle before counting emails. Poll for at least
    // one notice, then assert the total never exceeds one.
    let noticeCount = 0;
    for (let i = 0; i < 100 && noticeCount === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
      noticeCount = sendEmailNowMock.mock.calls.filter(
        (c: any[]) =>
          c[0]?.templateSlug === "signup_attempted" &&
          c[0]?.to === existing.email,
      ).length;
    }
    // Give any laggard dispatched workers a chance to over-send.
    await new Promise((r) => setTimeout(r, 100));
    const finalNoticeCount = sendEmailNowMock.mock.calls.filter(
      (c: any[]) =>
        c[0]?.templateSlug === "signup_attempted" && c[0]?.to === existing.email,
    ).length;
    expect(finalNoticeCount).toBe(1);
  });
});
