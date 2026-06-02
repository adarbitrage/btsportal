/**
 * Locks in the admin notification-bell entry for the moderation pod-silence
 * watchdog. When a previously-reporting moderation pod goes silent past the
 * staleness threshold, GET /api/admin/notifications must surface a
 * high-severity "moderation_pod_silent" entry linking to /admin/system so an
 * admin notices without first opening System Health.
 *
 * Combines the fake-Redis hash store + pod-silence seeding pattern from
 * `moderation-pod-silent-alerter.test.ts` (to flip the alerter into the
 * "paging" state) with the notifications-endpoint harness from
 * `admin-notifications-production-env-guard.test.ts`.
 */
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

interface FakeHashStore {
  hashes: Map<string, Map<string, string>>;
  ttls: Map<string, number>;
}

const sharedStore: FakeHashStore = { hashes: new Map(), ttls: new Map() };

vi.mock("../lib/redis", () => {
  const fakeRedis: any = {
    multi() {
      const ops: Array<() => void> = [];
      const results: Array<[Error | null, unknown]> = [];
      const m: any = {
        hincrby(key: string, field: string, by: number) {
          ops.push(() => {
            const h = sharedStore.hashes.get(key) ?? new Map<string, string>();
            const cur = Number.parseInt(h.get(field) ?? "0", 10) || 0;
            h.set(field, String(cur + by));
            sharedStore.hashes.set(key, h);
            results.push([null, cur + by]);
          });
          return m;
        },
        hset(key: string, ...fieldsAndValues: Array<string | number>) {
          ops.push(() => {
            const h = sharedStore.hashes.get(key) ?? new Map<string, string>();
            for (let i = 0; i < fieldsAndValues.length; i += 2) {
              h.set(String(fieldsAndValues[i]), String(fieldsAndValues[i + 1]));
            }
            sharedStore.hashes.set(key, h);
            results.push([null, 1]);
          });
          return m;
        },
        hdel(key: string, ...fields: string[]) {
          ops.push(() => {
            const h = sharedStore.hashes.get(key);
            let removed = 0;
            if (h) for (const f of fields) if (h.delete(f)) removed++;
            results.push([null, removed]);
          });
          return m;
        },
        expire(key: string, seconds: number) {
          ops.push(() => {
            sharedStore.ttls.set(key, Date.now() + seconds * 1000);
            results.push([null, 1]);
          });
          return m;
        },
        async exec() {
          for (const op of ops) op();
          return results;
        },
      };
      return m;
    },
    async scan(
      cursor: string,
      _match: string,
      pattern: string,
      _count: string,
      _n: number,
    ) {
      const re = new RegExp(
        "^" +
          pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
          "$",
      );
      const keys = Array.from(sharedStore.hashes.keys()).filter((k) =>
        re.test(k),
      );
      return [cursor === "0" ? "0" : "0", keys];
    },
    async hgetall(key: string) {
      const h = sharedStore.hashes.get(key);
      if (!h) return {};
      return Object.fromEntries(h.entries());
    },
  };
  return {
    getRedis: () => fakeRedis,
    getRedisConnection: vi.fn(),
    createRedisConnection: vi.fn(),
    isRedisConnected: vi.fn(async () => true),
    isRedisReady: () => true,
  };
});

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import { __podKeyForTests } from "../lib/moderation/failure-tracker";
import {
  evaluateModerationPodSilentAlert,
  __resetModerationPodSilentAlerterForTests,
  __setModerationPodSilentAlerterDeliveriesForTests,
} from "../lib/moderation/failure-alerter";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `notif-podsilent-${randomUUID().slice(0, 8)}`;

const WINDOW_MS = 15 * 60 * 1000;
const STALE_THRESHOLD_MS = WINDOW_MS * 2; // 30m

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
const seededIds: number[] = [];

/** Seed a remote pod that reported once at `lastAtMs` with no in-window failures. */
function seedSilentPod(instanceId: string, lastAtMs: number): void {
  const key = __podKeyForTests(instanceId);
  const h = new Map<string, string>();
  h.set("__instanceId", instanceId);
  h.set("__lastAt", String(lastAtMs));
  h.set("__lastError", "(old failure)");
  h.set("__lastKind", "engine");
  sharedStore.hashes.set(key, h);
}

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
});

afterAll(async () => {
  if (seededIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededIds));
  }
});

beforeEach(() => {
  sharedStore.hashes.clear();
  sharedStore.ttls.clear();
  __resetModerationPodSilentAlerterForTests();
  // Stub all delivery channels so flipping the alerter into "paging" state
  // never makes real network calls during the test.
  __setModerationPodSilentAlerterDeliveriesForTests({
    pagerduty: async () => ({ channel: "pagerduty", ok: true }),
    email: async () => ({ channel: "email", ok: true }),
    slack: async () => ({ channel: "slack", ok: true }),
  });
});

afterEach(() => {
  __setModerationPodSilentAlerterDeliveriesForTests(null);
  __resetModerationPodSilentAlerterForTests();
});

function findPodSilent(body: any): any {
  return body.find((n: any) => n.type === "moderation_pod_silent");
}

describe("GET /api/admin/notifications — moderation pod-silent bell entry", () => {
  it("surfaces a high-severity entry when a pod is flagged silent", async () => {
    const now = Date.now();
    seedSilentPod("pod-ghost:1:cccc", now - (STALE_THRESHOLD_MS + 60_000));
    // Flip the alerter into the "paging" state for this pod so the bell reads
    // it on the next notifications poll.
    await evaluateModerationPodSilentAlert(now);

    const res = await request(app)
      .get("/api/admin/notifications")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const entry = findPodSilent(res.body);
    expect(entry).toBeTruthy();
    expect(entry.id).toBe("moderation-pod-silent");
    expect(entry.type).toBe("moderation_pod_silent");
    expect(entry.severity).toBe("high");
    expect(entry.link).toBe("/admin/system");
    expect(typeof entry.title).toBe("string");
    expect(entry.title.length).toBeGreaterThan(0);
    expect(typeof entry.message).toBe("string");
    expect(entry.message).toContain("pod-ghost:1:cccc");
  });

  it("does not surface the entry when no pods are silent", async () => {
    const now = Date.now();
    // Pod reported 1m ago — well inside the staleness threshold, not silent.
    seedSilentPod("pod-fresh:1:aaaa", now - 60_000);
    await evaluateModerationPodSilentAlert(now);

    const res = await request(app)
      .get("/api/admin/notifications")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(findPodSilent(res.body)).toBeUndefined();
  });
});
