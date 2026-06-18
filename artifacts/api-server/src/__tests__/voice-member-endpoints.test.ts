import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  voiceCallsTable,
  voiceDailyUsageTable,
  productsTable,
  userProductsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

// voice.ts captures RETELL_FUNCTION_SECRET into a module-level const at import
// time, so it must be set BEFORE the router module is evaluated. vi.hoisted runs
// ahead of the static imports below, giving kb-search a known shared secret to
// authenticate against without depending on any live Retell configuration.
const KB_SECRET = vi.hoisted(() => {
  const secret = "test-kb-fn-secret";
  process.env.RETELL_FUNCTION_SECRET = secret;
  return secret;
});

import voiceRouter from "../routes/voice";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `voice-member-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const insertedCallIds: number[] = [];
const insertedUsageIds: number[] = [];
const insertedProductIds: number[] = [];
const insertedUserProductIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedUser(
  role: "super_admin" | "member",
  suffix: string,
): Promise<{ id: number; email: string; name: string; cookie: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const name = `Test ${suffix}`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email, name, cookie: signCookie(row.id, email) };
}

// Grant a user `voice:access` by creating a product carrying that entitlement
// key and an active, non-expiring ownership row. Mirrors how production
// entitlements are derived (see lib/entitlements.ts).
async function grantVoiceAccess(userId: number, suffix: string): Promise<void> {
  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-${suffix}-product`,
      name: `Voice Product ${suffix}`,
      type: "frontend",
      entitlementKeys: ["voice:access"],
    })
    .returning({ id: productsTable.id });
  insertedProductIds.push(product.id);

  const [up] = await db
    .insert(userProductsTable)
    .values({ userId, productId: product.id, status: "active", expiresAt: null })
    .returning({ id: userProductsTable.id });
  insertedUserProductIds.push(up.id);
}

function todayUtc(): string {
  return new Date().toISOString().split("T")[0];
}

function dateMinusDays(days: number): string {
  const d = new Date(todayUtc() + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

function middayOn(dateStr: string): Date {
  return new Date(dateStr + "T12:00:00.000Z");
}

async function insertUsage(userId: number, usageDate: string, secondsUsed: number): Promise<void> {
  const [row] = await db
    .insert(voiceDailyUsageTable)
    .values({ userId, usageDate, secondsUsed })
    .returning({ id: voiceDailyUsageTable.id });
  insertedUsageIds.push(row.id);
}

async function insertCall(args: {
  userId: number;
  startedAt: Date;
  endedAt?: Date | null;
  durationSeconds?: number | null;
  status?: string;
  transcript?: string | null;
  summary?: string | null;
  disconnectReason?: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(voiceCallsTable)
    .values({
      userId: args.userId,
      retellCallId: `${TEST_TAG}-${randomUUID()}`,
      status: args.status ?? "ended",
      startedAt: args.startedAt,
      endedAt: args.endedAt ?? null,
      durationSeconds: args.durationSeconds ?? null,
      transcript: args.transcript ?? null,
      summary: args.summary ?? null,
      disconnectReason: args.disconnectReason ?? null,
    })
    .returning({ id: voiceCallsTable.id });
  insertedCallIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([voiceRouter]);
});

afterAll(async () => {
  if (insertedCallIds.length > 0) {
    await db.delete(voiceCallsTable).where(inArray(voiceCallsTable.id, insertedCallIds));
  }
  if (insertedUsageIds.length > 0) {
    await db.delete(voiceDailyUsageTable).where(inArray(voiceDailyUsageTable.id, insertedUsageIds));
  }
  if (insertedUserProductIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.id, insertedUserProductIds));
  }
  if (insertedProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, insertedProductIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/voice/status", () => {
  it("grants access to an admin even without the voice entitlement", async () => {
    const admin = await seedUser("super_admin", "status-admin");
    const res = await request(app).get("/api/voice/status").set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.has_access).toBe(true);
  });

  it("grants access to a member who holds voice:access", async () => {
    const member = await seedUser("member", "status-entitled");
    await grantVoiceAccess(member.id, "status-entitled");
    const res = await request(app).get("/api/voice/status").set("Cookie", member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.has_access).toBe(true);
  });

  it("denies access to a member without the voice entitlement", async () => {
    const member = await seedUser("member", "status-noaccess");
    const res = await request(app).get("/api/voice/status").set("Cookie", member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.has_access).toBe(false);
    // No usage yet → full daily cap remains.
    expect(res.body.seconds_used_today).toBe(0);
    expect(res.body.daily_cap_seconds).toBeGreaterThan(0);
    expect(res.body.seconds_remaining).toBe(res.body.daily_cap_seconds);
  });

  it("computes seconds_used_today and seconds_remaining against the daily cap", async () => {
    const member = await seedUser("member", "status-usage");
    // Only today's usage row should count toward seconds_used_today; an older
    // row must be ignored by the date filter.
    await insertUsage(member.id, todayUtc(), 120);
    await insertUsage(member.id, dateMinusDays(2), 999);

    const res = await request(app).get("/api/voice/status").set("Cookie", member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.seconds_used_today).toBe(120);
    expect(res.body.seconds_remaining).toBe(res.body.daily_cap_seconds - 120);
  });

  it("clamps seconds_remaining at zero once usage exceeds the cap", async () => {
    const member = await seedUser("member", "status-overcap");
    const probe = await request(app).get("/api/voice/status").set("Cookie", member.cookie);
    const cap = probe.body.daily_cap_seconds as number;
    await insertUsage(member.id, todayUtc(), cap + 500);

    const res = await request(app).get("/api/voice/status").set("Cookie", member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.seconds_used_today).toBe(cap + 500);
    expect(res.body.seconds_remaining).toBe(0);
  });
});

describe("GET /api/voice/calls", () => {
  it("returns only ended calls, newest-first", async () => {
    const member = await seedUser("member", "calls-ended");

    // In-progress (no endedAt) call must be excluded entirely.
    await insertCall({ userId: member.id, startedAt: middayOn(todayUtc()), endedAt: null, status: "ongoing" });

    const newest = await insertCall({
      userId: member.id,
      startedAt: middayOn(todayUtc()),
      endedAt: middayOn(todayUtc()),
    });
    const middle = await insertCall({
      userId: member.id,
      startedAt: middayOn(dateMinusDays(1)),
      endedAt: middayOn(dateMinusDays(1)),
    });
    const oldest = await insertCall({
      userId: member.id,
      startedAt: middayOn(dateMinusDays(2)),
      endedAt: middayOn(dateMinusDays(2)),
    });

    const res = await request(app).get("/api/voice/calls").set("Cookie", member.cookie);
    expect(res.status).toBe(200);
    const ids = res.body.calls.map((c: { id: number }) => c.id);
    expect(ids).toEqual([newest, middle, oldest]);
    // The in-progress call is absent.
    expect(res.body.calls.every((c: { ended_at: string | null }) => c.ended_at !== null)).toBe(true);
  });

  it("clamps the limit into the 1..50 range", async () => {
    const member = await seedUser("member", "calls-limit");

    const tooLow = await request(app).get("/api/voice/calls?limit=0").set("Cookie", member.cookie);
    expect(tooLow.status).toBe(200);
    expect(tooLow.body.limit).toBe(1);

    const tooHigh = await request(app).get("/api/voice/calls?limit=100").set("Cookie", member.cookie);
    expect(tooHigh.status).toBe(200);
    expect(tooHigh.body.limit).toBe(50);
  });

  it("pages via limit/offset and reports has_more", async () => {
    const member = await seedUser("member", "calls-paging");

    const ids: number[] = [];
    // Newest first → index 0 is the most recent.
    for (let i = 0; i < 3; i++) {
      ids.push(
        await insertCall({
          userId: member.id,
          startedAt: middayOn(dateMinusDays(i)),
          endedAt: middayOn(dateMinusDays(i)),
        }),
      );
    }

    const page1 = await request(app)
      .get("/api/voice/calls?limit=2&offset=0")
      .set("Cookie", member.cookie);
    expect(page1.status).toBe(200);
    expect(page1.body.limit).toBe(2);
    expect(page1.body.offset).toBe(0);
    expect(page1.body.has_more).toBe(true);
    expect(page1.body.calls.map((c: { id: number }) => c.id)).toEqual([ids[0], ids[1]]);

    const page2 = await request(app)
      .get("/api/voice/calls?limit=2&offset=2")
      .set("Cookie", member.cookie);
    expect(page2.status).toBe(200);
    expect(page2.body.offset).toBe(2);
    expect(page2.body.has_more).toBe(false);
    expect(page2.body.calls.map((c: { id: number }) => c.id)).toEqual([ids[2]]);
  });
});

describe("POST /api/voice/kb-search", () => {
  it("rejects a request with a missing bearer secret", async () => {
    const res = await request(app)
      .post("/api/voice/kb-search")
      .send({ query: "commissions" });
    expect(res.status).toBe(401);
  });

  it("rejects a request with the wrong bearer secret", async () => {
    const res = await request(app)
      .post("/api/voice/kb-search")
      .set("Authorization", "Bearer not-the-secret")
      .send({ query: "commissions" });
    expect(res.status).toBe(401);
  });

  it("returns 400 for an empty query once authenticated", async () => {
    const missing = await request(app)
      .post("/api/voice/kb-search")
      .set("Authorization", `Bearer ${KB_SECRET}`)
      .send({});
    expect(missing.status).toBe(400);

    const blank = await request(app)
      .post("/api/voice/kb-search")
      .set("Authorization", `Bearer ${KB_SECRET}`)
      .send({ query: "   " });
    expect(blank.status).toBe(400);
  });
});
