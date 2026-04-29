import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

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
      zremrangebyrank(_key: string, _start: number, _stop: number) {
        ops.push(() => results.push([null, 0]));
        return multi;
      },
      expire(_key: string, _seconds: number) {
        ops.push(() => results.push([null, 1]));
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

  return { redisGetMock: vi.fn(() => fakeRedis), sortedSets };
});

vi.mock("../lib/redis", () => ({
  getRedis: redisGetMock,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: vi.fn(async () => true),
}));

import { db, usersTable, upgradePromptEventsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { buildTestAppWithRouters } from "./test-app";
import analyticsRouter, { ANALYTICS_EVENTS_RATE_LIMIT } from "../routes/analytics";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `analytics-events-rl-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;

async function seedMember(): Promise<{ id: number; cookie: string }> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Analytics RL Test",
      passwordHash,
      role: "member",
      sourceProduct: "free",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  return { id: row.id, cookie: `access_token=${token}` };
}

beforeAll(() => {
  app = buildTestAppWithRouters([analyticsRouter]);
});

beforeEach(() => {
  sortedSets.clear();
  redisGetMock.mockClear();
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(upgradePromptEventsTable).where(inArray(upgradePromptEventsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

function postEvent(cookie: string) {
  return request(app)
    .post("/api/analytics/events")
    .set("Cookie", cookie)
    .send({
      eventType: "impression",
      variant: "dashboard",
      sourceTier: "free",
      lockedFeatureKeys: ["software"],
    });
}

describe("POST /api/analytics/events — per-user rate limiting", () => {
  it("returns 429 once an authenticated member exceeds the per-user cap within the window", async () => {
    const { cookie } = await seedMember();
    const cap = ANALYTICS_EVENTS_RATE_LIMIT.maxRequests;

    // Burn the entire per-user budget. Every one of these should succeed.
    for (let i = 0; i < cap; i++) {
      const res = await postEvent(cookie);
      expect(res.status).toBe(204);
    }

    // The next request must be rejected with a 429 from the abuse-rate
    // middleware, signalling the client (or runaway loop) to back off.
    const blocked = await postEvent(cookie);
    expect(blocked.status).toBe(429);
    expect(blocked.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("isolates the cap per user — one member tripping the limiter does not block another", async () => {
    const { cookie: cookieA } = await seedMember();
    const { cookie: cookieB } = await seedMember();
    const cap = ANALYTICS_EVENTS_RATE_LIMIT.maxRequests;

    // Member A burns through the entire budget and gets a 429.
    for (let i = 0; i < cap; i++) {
      const res = await postEvent(cookieA);
      expect(res.status).toBe(204);
    }
    const blockedA = await postEvent(cookieA);
    expect(blockedA.status).toBe(429);

    // Member B, who has done nothing yet, should still be able to log a
    // legitimate impression even though the system is under attack from A.
    const okB = await postEvent(cookieB);
    expect(okB.status).toBe(204);
  });

  it("does not store a row for requests that get rate-limited", async () => {
    const { id, cookie } = await seedMember();
    const cap = ANALYTICS_EVENTS_RATE_LIMIT.maxRequests;

    for (let i = 0; i < cap; i++) {
      const res = await postEvent(cookie);
      expect(res.status).toBe(204);
    }
    const blocked = await postEvent(cookie);
    expect(blocked.status).toBe(429);

    const rows = await db
      .select()
      .from(upgradePromptEventsTable)
      .where(inArray(upgradePromptEventsTable.userId, [id]));
    // We allow exactly `cap` rows — the blocked request must not have
    // reached the insert.
    expect(rows).toHaveLength(cap);
  });
});
