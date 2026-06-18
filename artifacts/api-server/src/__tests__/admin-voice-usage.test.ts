import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, voiceCallsTable, voiceDailyUsageTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import voiceRouter from "../routes/voice";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `voice-usage-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const insertedCallIds: number[] = [];
const insertedUsageIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
let memberCookie = "";

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

// Mirror voice.ts getTodayDate(): UTC calendar date.
function todayUtc(): string {
  return new Date().toISOString().split("T")[0];
}

function dateMinusDays(days: number): string {
  const d = new Date(todayUtc() + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

// Midday UTC timestamp for a given calendar date so `started_at::date`
// resolves to that same day regardless of the DB session timezone.
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
  const admin = await seedUser("super_admin", "admin");
  const member = await seedUser("member", "member");
  adminCookie = admin.cookie;
  memberCookie = member.cookie;
});

afterAll(async () => {
  if (insertedCallIds.length > 0) {
    await db.delete(voiceCallsTable).where(inArray(voiceCallsTable.id, insertedCallIds));
  }
  if (insertedUsageIds.length > 0) {
    await db.delete(voiceDailyUsageTable).where(inArray(voiceDailyUsageTable.id, insertedUsageIds));
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

describe("GET /api/admin/voice/usage", () => {
  it("rolls up today/week/month seconds and call counts across the windows", async () => {
    // Capture a baseline so the assertions are robust against any other voice
    // rows already present in the dev DB — we assert on the delta our rows add.
    const before = await request(app)
      .get("/api/admin/voice/usage")
      .set("Cookie", adminCookie);
    expect(before.status).toBe(200);
    const base = before.body.totals;

    const u = await seedUser("member", "totals");

    // Seconds via the authoritative voice_daily_usage table.
    await insertUsage(u.id, todayUtc(), 100); // today + week + month
    await insertUsage(u.id, dateMinusDays(3), 200); // week + month
    await insertUsage(u.id, dateMinusDays(15), 400); // month only
    await insertUsage(u.id, dateMinusDays(40), 800); // outside all windows

    // Call counts via voice_calls (every started call, bucketed by start date).
    await insertCall({ userId: u.id, startedAt: middayOn(todayUtc()) });
    await insertCall({ userId: u.id, startedAt: middayOn(dateMinusDays(3)) });
    await insertCall({ userId: u.id, startedAt: middayOn(dateMinusDays(15)) });
    await insertCall({ userId: u.id, startedAt: middayOn(dateMinusDays(40)) });

    const res = await request(app)
      .get("/api/admin/voice/usage")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const t = res.body.totals;

    expect(t.today.seconds - base.today.seconds).toBe(100);
    expect(t.week.seconds - base.week.seconds).toBe(300);
    expect(t.month.seconds - base.month.seconds).toBe(700);

    expect(t.today.calls - base.today.calls).toBe(1);
    expect(t.week.calls - base.week.calls).toBe(2);
    expect(t.month.calls - base.month.calls).toBe(3);

    expect(res.body.dailyCapSeconds).toBeGreaterThan(0);
  });

  it("orders top members by usage descending for the requested period", async () => {
    const heavy = await seedUser("member", "top-heavy");
    const medium = await seedUser("member", "top-medium");
    const light = await seedUser("member", "top-light");

    // All within the default (month) window.
    await insertUsage(heavy.id, todayUtc(), 500);
    await insertUsage(medium.id, todayUtc(), 300);
    await insertUsage(light.id, todayUtc(), 100);

    // A couple of calls for the heavy user to verify the per-member call count.
    await insertCall({ userId: heavy.id, startedAt: middayOn(todayUtc()) });
    await insertCall({ userId: heavy.id, startedAt: middayOn(dateMinusDays(2)) });

    const res = await request(app)
      .get("/api/admin/voice/usage?period=month&limit=100")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.topMembers.period).toBe("month");

    const ourIds = new Set([heavy.id, medium.id, light.id]);
    const ours = (res.body.topMembers.members as Array<{ userId: number; secondsUsed: number; callCount: number }>)
      .filter((m) => ourIds.has(m.userId));
    expect(ours.map((m) => m.userId)).toEqual([heavy.id, medium.id, light.id]);
    expect(ours.map((m) => m.secondsUsed)).toEqual([500, 300, 100]);

    const heavyRow = ours.find((m) => m.userId === heavy.id)!;
    expect(heavyRow.callCount).toBe(2);
  });
});

describe("GET /api/admin/voice/calls", () => {
  it("paginates and filters by userId", async () => {
    const u = await seedUser("member", "calls-pagination");

    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        await insertCall({
          userId: u.id,
          startedAt: middayOn(dateMinusDays(i)),
          durationSeconds: 60 + i,
        }),
      );
    }

    const page1 = await request(app)
      .get(`/api/admin/voice/calls?userId=${u.id}&limit=2&page=1`)
      .set("Cookie", adminCookie);
    expect(page1.status).toBe(200);
    expect(page1.body.total).toBe(3);
    expect(page1.body.page).toBe(1);
    expect(page1.body.limit).toBe(2);
    expect(page1.body.calls).toHaveLength(2);
    expect(page1.body.calls.every((c: { userId: number }) => c.userId === u.id)).toBe(true);
    // Newest-first ordering by started_at.
    const p1Ids = page1.body.calls.map((c: { id: number }) => c.id);
    expect(p1Ids).toEqual([ids[0], ids[1]]);

    const page2 = await request(app)
      .get(`/api/admin/voice/calls?userId=${u.id}&limit=2&page=2`)
      .set("Cookie", adminCookie);
    expect(page2.status).toBe(200);
    expect(page2.body.calls).toHaveLength(1);
    expect(page2.body.calls[0].id).toBe(ids[2]);
  });

  it("exposes hasTranscript/hasSummary flags without leaking the bodies", async () => {
    const u = await seedUser("member", "calls-flags");
    await insertCall({
      userId: u.id,
      startedAt: middayOn(todayUtc()),
      transcript: "agent: hello",
      summary: null,
    });

    const res = await request(app)
      .get(`/api/admin/voice/calls?userId=${u.id}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(1);
    const row = res.body.calls[0];
    expect(row.hasTranscript).toBe(true);
    expect(row.hasSummary).toBe(false);
    expect(row).not.toHaveProperty("transcript");
    expect(row).not.toHaveProperty("summary");
  });
});

describe("GET /api/admin/voice/calls/:id", () => {
  it("returns a single call with transcript and summary", async () => {
    const u = await seedUser("member", "single-call");
    const callId = await insertCall({
      userId: u.id,
      startedAt: middayOn(todayUtc()),
      endedAt: middayOn(todayUtc()),
      durationSeconds: 123,
      transcript: "agent: hi\nuser: hello",
      summary: "Short friendly call.",
      disconnectReason: "user_hangup",
    });

    const res = await request(app)
      .get(`/api/admin/voice/calls/${callId}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.call).toMatchObject({
      id: callId,
      userId: u.id,
      durationSeconds: 123,
      transcript: "agent: hi\nuser: hello",
      summary: "Short friendly call.",
      disconnectReason: "user_hangup",
      email: u.email,
      name: u.name,
    });
  });

  it("returns 400 for an invalid id and 404 for a missing call", async () => {
    const bad = await request(app)
      .get("/api/admin/voice/calls/not-a-number")
      .set("Cookie", adminCookie);
    expect(bad.status).toBe(400);

    const missing = await request(app)
      .get("/api/admin/voice/calls/2147483646")
      .set("Cookie", adminCookie);
    expect(missing.status).toBe(404);
  });
});

describe("admin voice usage permission gate", () => {
  it("rejects callers without system:view permission", async () => {
    const usage = await request(app)
      .get("/api/admin/voice/usage")
      .set("Cookie", memberCookie);
    expect(usage.status).toBe(403);

    const calls = await request(app)
      .get("/api/admin/voice/calls")
      .set("Cookie", memberCookie);
    expect(calls.status).toBe(403);

    const single = await request(app)
      .get("/api/admin/voice/calls/1")
      .set("Cookie", memberCookie);
    expect(single.status).toBe(403);
  });
});
