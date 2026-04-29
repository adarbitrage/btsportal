import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { inArray, like } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import { AUTH_RATE_LIMIT_AUDIT_ACTION, AUTH_RATE_LIMIT_AUDIT_ENTITY } from "../routes/auth";
import {
  simulateWouldHaveFired,
  coerceLookbackDays,
  MAX_LOOKBACK_DAYS,
  MIN_LOOKBACK_DAYS,
  DEFAULT_LOOKBACK_DAYS,
} from "../lib/auth-rate-limit-alert-traffic-preview";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `arl-traffic-preview-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string): Promise<{ id: number; email: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email };
}

async function insertHit(opts: { ip?: string | null; minutesAgo: number }) {
  await db.insert(auditLogTable).values({
    actorId: null,
    actorEmail: null,
    actionType: AUTH_RATE_LIMIT_AUDIT_ACTION,
    entityType: AUTH_RATE_LIMIT_AUDIT_ENTITY,
    entityId: "login",
    description: `[${TEST_TAG}] simulated rate-limit hit`,
    ipAddress: opts.ip ?? null,
    metadata: { source: TEST_TAG },
    createdAt: new Date(Date.now() - opts.minutesAgo * 60 * 1000),
  });
}

async function clearTaggedRows() {
  // Only delete rows this suite owns — identified by the unique TEST_TAG
  // prefix in the description. We deliberately avoid wiping by
  // actionType so we don't disturb rows from other suites or any
  // pre-existing data, even if Vitest's execution strategy changes.
  await db.delete(auditLogTable).where(like(auditLogTable.description, `[${TEST_TAG}]%`));
}

/**
 * Filter a traffic-preview response down to only the rows this suite
 * inserted. The endpoint returns aggregates over all
 * `AUTH_RATE_LIMIT_AUDIT_ACTION` rows in the lookback window, so
 * concurrent suites or pre-existing data could otherwise leak in. We
 * recompute hit counts from the tagged rows we own, and we filter the
 * raw event-timestamp list down to those tagged rows so simulation
 * assertions are deterministic.
 */
async function readOwnHits(): Promise<{ count: number; timestampsMs: number[] }> {
  const rows = await db
    .select({ createdAt: auditLogTable.createdAt })
    .from(auditLogTable)
    .where(like(auditLogTable.description, `[${TEST_TAG}]%`));
  const timestampsMs = rows
    .map((r) => (r.createdAt instanceof Date ? r.createdAt.getTime() : NaN))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  return { count: rows.length, timestampsMs };
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const admin = await insertUser("super_admin", "admin");
  const member = await insertUser("member", "non-admin");
  adminCookie = signCookie(admin.id, admin.email);
  memberCookie = signCookie(member.id, member.email);
});

afterAll(async () => {
  await clearTaggedRows();
  if (seededUserIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(async () => {
  await clearTaggedRows();
});

describe("simulateWouldHaveFired (pure)", () => {
  it("returns zeros when there are no events", () => {
    expect(simulateWouldHaveFired({ eventTimestampsMs: [], threshold: 5, windowMinutes: 15 })).toEqual({
      wouldHaveFiredCount: 0,
      peakWindowHits: 0,
    });
  });

  it("returns zeros when threshold or window is invalid", () => {
    expect(simulateWouldHaveFired({ eventTimestampsMs: [1, 2, 3], threshold: 0, windowMinutes: 15 })).toEqual({
      wouldHaveFiredCount: 0,
      peakWindowHits: 0,
    });
    expect(simulateWouldHaveFired({ eventTimestampsMs: [1, 2, 3], threshold: 5, windowMinutes: 0 })).toEqual({
      wouldHaveFiredCount: 0,
      peakWindowHits: 0,
    });
  });

  it("counts a single sustained burst as exactly one fire", () => {
    // 10 events 30s apart all fit in a 15-min window, so threshold=5 fires once.
    const base = Date.now();
    const ts = Array.from({ length: 10 }, (_, i) => base + i * 30 * 1000);
    const result = simulateWouldHaveFired({ eventTimestampsMs: ts, threshold: 5, windowMinutes: 15 });
    expect(result.wouldHaveFiredCount).toBe(1);
    expect(result.peakWindowHits).toBe(10);
  });

  it("counts two separate bursts as two fires when traffic drops below threshold between them", () => {
    // First burst: 5 events at minute 0 (window=5, threshold=3 => fires).
    // Long gap so the window empties.
    // Second burst: 5 events one hour later (fresh fire transition).
    const base = Date.now();
    const ts = [
      base + 0,
      base + 10 * 1000,
      base + 20 * 1000,
      base + 30 * 1000,
      base + 40 * 1000,
      base + 60 * 60 * 1000,
      base + 60 * 60 * 1000 + 10 * 1000,
      base + 60 * 60 * 1000 + 20 * 1000,
      base + 60 * 60 * 1000 + 30 * 1000,
      base + 60 * 60 * 1000 + 40 * 1000,
    ];
    const result = simulateWouldHaveFired({ eventTimestampsMs: ts, threshold: 3, windowMinutes: 5 });
    expect(result.wouldHaveFiredCount).toBe(2);
    expect(result.peakWindowHits).toBe(5);
  });

  it("does not fire when threshold is never reached", () => {
    const base = Date.now();
    const ts = [base, base + 60 * 1000, base + 2 * 60 * 1000];
    const result = simulateWouldHaveFired({ eventTimestampsMs: ts, threshold: 10, windowMinutes: 15 });
    expect(result.wouldHaveFiredCount).toBe(0);
    expect(result.peakWindowHits).toBe(3);
  });

  it("handles unsorted input by sorting defensively", () => {
    const base = Date.now();
    const ts = [base + 30000, base + 10000, base + 20000, base, base + 40000];
    const result = simulateWouldHaveFired({ eventTimestampsMs: ts, threshold: 3, windowMinutes: 5 });
    expect(result.wouldHaveFiredCount).toBe(1);
    expect(result.peakWindowHits).toBe(5);
  });
});

describe("coerceLookbackDays", () => {
  it("returns the default for missing / blank input", () => {
    expect(coerceLookbackDays(undefined)).toBe(DEFAULT_LOOKBACK_DAYS);
    expect(coerceLookbackDays(null)).toBe(DEFAULT_LOOKBACK_DAYS);
    expect(coerceLookbackDays("")).toBe(DEFAULT_LOOKBACK_DAYS);
    expect(coerceLookbackDays("abc")).toBe(DEFAULT_LOOKBACK_DAYS);
  });

  it("clamps to the allowed range and floors fractions", () => {
    expect(coerceLookbackDays(0)).toBe(MIN_LOOKBACK_DAYS);
    expect(coerceLookbackDays(-99)).toBe(MIN_LOOKBACK_DAYS);
    expect(coerceLookbackDays(9999)).toBe(MAX_LOOKBACK_DAYS);
    expect(coerceLookbackDays("3.7")).toBe(3);
    expect(coerceLookbackDays(14)).toBe(14);
  });
});

describe("GET /admin/auth-rate-limit-alert-config/traffic-preview", () => {
  it("requires admin auth", async () => {
    const res = await request(app).get("/api/admin/auth-rate-limit-alert-config/traffic-preview");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users", async () => {
    const res = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config/traffic-preview")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });

  it("returns a dense daily array of the right shape with no tagged traffic", async () => {
    // Note: totalHits is NOT asserted to be 0 — other suites in this
    // monorepo may leave behind real `auth_rate_limit_blocked` rows. We
    // only assert the shape of the response here; per-row counts are
    // covered by the tagged-rows tests below.
    const res = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config/traffic-preview")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.lookbackDays).toBe(DEFAULT_LOOKBACK_DAYS);
    expect(res.body.truncated).toBe(false);
    expect(Array.isArray(res.body.dailyBuckets)).toBe(true);
    // Always lookbackDays + 1 buckets (today partial included).
    expect(res.body.dailyBuckets.length).toBe(DEFAULT_LOOKBACK_DAYS + 1);
    for (const b of res.body.dailyBuckets) {
      expect(typeof b.hits).toBe("number");
      expect(b.hits).toBeGreaterThanOrEqual(0);
      expect(typeof b.dayStart).toBe("string");
    }
    expect(Array.isArray(res.body.eventTimestampsMs)).toBe(true);
  });

  it("counts seeded rows in totalHits and returns their timestamps", async () => {
    for (let i = 0; i < 4; i++) await insertHit({ ip: "203.0.113.1", minutesAgo: 1 });
    for (let i = 0; i < 3; i++) await insertHit({ ip: "203.0.113.2", minutesAgo: 60 * 24 });

    const res = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config/traffic-preview")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    // Confirm our 7 owned rows are part of the response (untagged rows
    // from other suites, if any, are >=0 extra).
    const own = await readOwnHits();
    expect(own.count).toBe(7);
    expect(res.body.totalHits).toBeGreaterThanOrEqual(7);
    expect(res.body.eventTimestampsMs.length).toBeGreaterThanOrEqual(7);
    // Every owned timestamp must appear in the response's event list.
    const responseSet = new Set<number>(res.body.eventTimestampsMs);
    for (const ts of own.timestampsMs) expect(responseSet.has(ts)).toBe(true);
    // Daily buckets sum back to totalHits (basic invariant).
    const sum = res.body.dailyBuckets.reduce(
      (acc: number, b: { hits: number }) => acc + b.hits,
      0,
    );
    expect(sum).toBe(res.body.totalHits);
  });

  it("respects ?lookbackDays= when narrowing the window", async () => {
    // 5 hits today, 5 hits 5 days ago. With lookbackDays=2 only today's
    // tagged rows should be inside the window.
    for (let i = 0; i < 5; i++) await insertHit({ ip: "203.0.113.10", minutesAgo: 1 });
    for (let i = 0; i < 5; i++) await insertHit({ ip: "203.0.113.11", minutesAgo: 60 * 24 * 5 });

    const res = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config/traffic-preview?lookbackDays=2")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.lookbackDays).toBe(2);
    expect(res.body.dailyBuckets.length).toBe(3);

    // Of OUR 10 inserted rows, only the 5 recent ones should be inside
    // a 2-day window.
    const own = await readOwnHits();
    const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const ownInWindow = own.timestampsMs.filter((t) => t >= cutoff).length;
    expect(ownInWindow).toBe(5);
    const responseSet = new Set<number>(res.body.eventTimestampsMs);
    for (const ts of own.timestampsMs.filter((t) => t >= cutoff)) {
      expect(responseSet.has(ts)).toBe(true);
    }
    // Old rows must not have leaked in.
    for (const ts of own.timestampsMs.filter((t) => t < cutoff)) {
      expect(responseSet.has(ts)).toBe(false);
    }
  });

  it("clamps an out-of-range ?lookbackDays= to the allowed maximum", async () => {
    const res = await request(app)
      .get(`/api/admin/auth-rate-limit-alert-config/traffic-preview?lookbackDays=${MAX_LOOKBACK_DAYS + 1000}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.lookbackDays).toBe(MAX_LOOKBACK_DAYS);
  });

  it("simulates the alerter exactly: a single sustained burst counts once", async () => {
    // 6 hits in the last minute. simulateWouldHaveFired with threshold=3,
    // window=5min should report exactly 1 fire and peak=6 against ONLY
    // our owned timestamps (so we're robust against unrelated rows that
    // other suites may have left behind).
    for (let i = 0; i < 6; i++) await insertHit({ ip: "203.0.113.42", minutesAgo: 1 });

    const res = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config/traffic-preview")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const own = await readOwnHits();
    expect(own.count).toBe(6);
    // Our 6 timestamps are present in the response.
    const responseSet = new Set<number>(res.body.eventTimestampsMs);
    for (const ts of own.timestampsMs) expect(responseSet.has(ts)).toBe(true);

    // Run the simulator against just our rows for a deterministic check.
    const sim = simulateWouldHaveFired({
      eventTimestampsMs: own.timestampsMs,
      threshold: 3,
      windowMinutes: 5,
    });
    expect(sim.wouldHaveFiredCount).toBe(1);
    expect(sim.peakWindowHits).toBe(6);
  });
});
