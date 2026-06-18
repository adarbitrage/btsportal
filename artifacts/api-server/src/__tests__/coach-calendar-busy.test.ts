import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, coachesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

// GET /api/coach/group-calls/calendar-busy overlays a coach's external Google
// Calendar busy blocks onto the Group Coaching month grid. Scoping mirrors the
// group-calls list: a plain coach reads their OWN calendar, an admin must pass
// ?coachId, and the all-coaches view has no single calendar. The route never
// throws to the client for a missing/expired connection — it returns
// { connected: false } (with needsReconnect for an older Drive-only grant).

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

// Control which user has a live token and what free/busy comes back, without
// touching Google. CalendarScopeError stays the REAL class so the route's
// `instanceof` reconnect branch is exercised.
const accessTokenByUser = new Map<number, string | null>();
const getAccessTokenForUser = vi.fn(
  async (userId: number) => accessTokenByUser.get(userId) ?? null,
);
let fetchBusyImpl: (token: string, from: string, to: string) => Promise<unknown>;
const fetchCalendarBusy = vi.fn(
  (token: string, from: string, to: string) => fetchBusyImpl(token, from, to),
);

vi.mock("../lib/coach-google-connections", () => ({
  getAccessTokenForUser: (userId: number) => getAccessTokenForUser(userId),
}));

vi.mock("../lib/google-oauth", async () => {
  const actual = await vi.importActual<typeof import("../lib/google-oauth")>(
    "../lib/google-oauth",
  );
  return {
    ...actual,
    fetchCalendarBusy: (token: string, from: string, to: string) =>
      fetchCalendarBusy(token, from, to),
  };
});

import { buildTestAppWithRouters } from "./test-app";
import coachDashboardRouter from "../routes/coach-dashboard";
import { CalendarScopeError } from "../lib/google-oauth";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `coach-busy-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let coachCookie: string;
let unlinkedCoachCookie: string;

const userIds: number[] = [];
const coachIds: number[] = [];

let coachUserId: number;
let coachId: number;

// A fixed [from, to) month-grid window used by most cases.
const FROM = new Date(2026, 6, 1, 0, 0, 0).toISOString();
const TO = new Date(2026, 7, 9, 0, 0, 0).toISOString();

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-${suffix}@example.test`,
      name: `User ${suffix}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  userIds.push(row.id);
  return row.id;
}

async function insertCoach(name: string, userId: number | null): Promise<number> {
  const [row] = await db
    .insert(coachesTable)
    .values({
      name,
      ghlCalendarId: `${TAG}-${name}-cal`,
      ghlLocationId: `${TAG}-loc`,
      userId,
    })
    .returning({ id: coachesTable.id });
  coachIds.push(row.id);
  return row.id;
}

let adminId: number;

beforeAll(async () => {
  app = buildTestAppWithRouters([coachDashboardRouter]);

  adminId = await insertUser("super_admin", "admin");
  adminCookie = signCookie(adminId, `${TAG}-admin@example.test`);

  coachUserId = await insertUser("coach", "coach");
  coachCookie = signCookie(coachUserId, `${TAG}-coach@example.test`);

  const unlinkedUserId = await insertUser("coach", "unlinked");
  unlinkedCoachCookie = signCookie(unlinkedUserId, `${TAG}-unlinked@example.test`);

  coachId = await insertCoach("BusyCoach", coachUserId);
});

afterAll(async () => {
  if (coachIds.length) await db.delete(coachesTable).where(inArray(coachesTable.id, coachIds));
  if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
});

beforeEach(() => {
  accessTokenByUser.clear();
  getAccessTokenForUser.mockClear();
  fetchCalendarBusy.mockClear();
  // Default: a working connection that returns one busy block.
  fetchBusyImpl = async () => [
    {
      start: new Date(2026, 6, 15, 14, 30, 0).toISOString(),
      end: new Date(2026, 6, 15, 15, 30, 0).toISOString(),
    },
  ];
});

describe("GET /api/coach/group-calls/calendar-busy", () => {
  it("returns busy blocks for a plain coach reading their own connected calendar", async () => {
    accessTokenByUser.set(coachUserId, "token-coach");

    const res = await request(app)
      .get(`/api/coach/group-calls/calendar-busy?from=${FROM}&to=${TO}`)
      .set("Cookie", coachCookie);

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.busy).toHaveLength(1);
    expect(res.body.busy[0].start).toBeTruthy();
    // The token came from the signed-in coach's own user id.
    expect(getAccessTokenForUser).toHaveBeenCalledWith(coachUserId);
  });

  it("returns connected:false when the coach has no live Google connection", async () => {
    // No token registered for this user -> getAccessTokenForUser returns null.
    const res = await request(app)
      .get(`/api/coach/group-calls/calendar-busy?from=${FROM}&to=${TO}`)
      .set("Cookie", coachCookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, busy: [] });
    expect(fetchCalendarBusy).not.toHaveBeenCalled();
  });

  it("flags needsReconnect when the calendar scope was never granted", async () => {
    accessTokenByUser.set(coachUserId, "token-coach");
    fetchBusyImpl = async () => {
      throw new CalendarScopeError("calendar scope missing");
    };

    const res = await request(app)
      .get(`/api/coach/group-calls/calendar-busy?from=${FROM}&to=${TO}`)
      .set("Cookie", coachCookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, needsReconnect: true, busy: [] });
  });

  it("500s when free/busy fails for a non-scope reason", async () => {
    accessTokenByUser.set(coachUserId, "token-coach");
    fetchBusyImpl = async () => {
      throw new Error("network down");
    };

    const res = await request(app)
      .get(`/api/coach/group-calls/calendar-busy?from=${FROM}&to=${TO}`)
      .set("Cookie", coachCookie);

    expect(res.status).toBe(500);
  });

  it("returns connected:false for a coach with no linked coach record", async () => {
    accessTokenByUser.set(coachUserId, "token-coach");

    const res = await request(app)
      .get(`/api/coach/group-calls/calendar-busy?from=${FROM}&to=${TO}`)
      .set("Cookie", unlinkedCoachCookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, busy: [] });
  });

  it("lets an admin read a specific coach's calendar via ?coachId", async () => {
    accessTokenByUser.set(coachUserId, "token-coach");

    const res = await request(app)
      .get(`/api/coach/group-calls/calendar-busy?coachId=${coachId}&from=${FROM}&to=${TO}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.busy).toHaveLength(1);
    // Admin reads the TARGET coach's user calendar, not their own.
    expect(getAccessTokenForUser).toHaveBeenCalledWith(coachUserId);
  });

  it("returns connected:false for an admin all-coaches view (no coachId)", async () => {
    accessTokenByUser.set(coachUserId, "token-coach");

    const res = await request(app)
      .get(`/api/coach/group-calls/calendar-busy?from=${FROM}&to=${TO}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, busy: [] });
    expect(getAccessTokenForUser).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric coachId from an admin", async () => {
    const res = await request(app)
      .get(`/api/coach/group-calls/calendar-busy?coachId=abc&from=${FROM}&to=${TO}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
  });

  it("rejects a missing/invalid from/to window", async () => {
    accessTokenByUser.set(coachUserId, "token-coach");
    const res = await request(app)
      .get(`/api/coach/group-calls/calendar-busy`)
      .set("Cookie", coachCookie);
    expect(res.status).toBe(400);
  });

  it("rejects a window larger than the month-grid cap", async () => {
    accessTokenByUser.set(coachUserId, "token-coach");
    const from = new Date(2026, 0, 1).toISOString();
    const to = new Date(2026, 5, 1).toISOString(); // ~150 days
    const res = await request(app)
      .get(`/api/coach/group-calls/calendar-busy?from=${from}&to=${to}`)
      .set("Cookie", coachCookie);
    expect(res.status).toBe(400);
  });
});
