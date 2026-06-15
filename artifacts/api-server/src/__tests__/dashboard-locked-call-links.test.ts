import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  coachesTable,
  coachingCallsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Access-control regression guard for the dashboard's upcoming coaching calls.
// The `/dashboard` handler scrubs `meetLink` and `recordingUrl` to null for any
// upcoming call a member is NOT entitled to (see `upcomingCallsMapped` in
// routes/dashboard.ts). This is a real paywall boundary: if a future change
// drops the scrub, paid call links would leak to members who never bought the
// entitling product. These tests pin the behavior for both the locked-out and
// the entitled member.

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
}));

import { buildTestAppWithRouters } from "./test-app";
import dashboardRouter from "../routes/dashboard";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(suffix: string): Promise<{ id: number; email: string }> {
  const email = `dash-call-${suffix}-${randomUUID().slice(0, 8)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Dash Call ${suffix}`,
      passwordHash,
      role: "member",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  return { id: row.id, email };
}

describe("GET /dashboard upcoming coaching call link scrubbing", () => {
  const PREFIX = `__dash_call_test__${randomUUID().slice(0, 8)}`;
  const ENTITLEMENT = "coaching:group";
  const MEET_LINK = "https://meet.example.test/locked-call";
  const RECORDING_URL = "https://rec.example.test/locked-call.mp4";

  let app: ReturnType<typeof buildTestAppWithRouters>;

  let entitledUserId: number;
  let entitledCookie: string;
  let lockedUserId: number;
  let lockedCookie: string;

  let productId: number;
  const userProductIds: number[] = [];
  let coachId: number;
  let callId: number;

  beforeAll(async () => {
    app = buildTestAppWithRouters([dashboardRouter]);

    const entitledUser = await insertUser("entitled");
    entitledUserId = entitledUser.id;
    entitledCookie = signCookie(entitledUser.id, entitledUser.email);

    const lockedUser = await insertUser("locked");
    lockedUserId = lockedUser.id;
    lockedCookie = signCookie(lockedUser.id, lockedUser.email);

    // A product whose entitlement_keys grant the call's required entitlement.
    const [product] = await db
      .insert(productsTable)
      .values({
        slug: `${PREFIX}-product`,
        name: "Dash Call Coaching Product",
        type: "frontend",
        entitlementKeys: [ENTITLEMENT],
      })
      .returning({ id: productsTable.id });
    productId = product.id;

    // Only the entitled user owns it (active, no expiry).
    const [up] = await db
      .insert(userProductsTable)
      .values({
        userId: entitledUserId,
        productId,
        status: "active",
        expiresAt: null,
      })
      .returning({ id: userProductsTable.id });
    userProductIds.push(up.id);

    const [coach] = await db
      .insert(coachesTable)
      .values({
        name: `${PREFIX}-coach`,
        bio: "Test coach",
        specialties: "Testing",
      })
      .returning({ id: coachesTable.id });
    coachId = coach.id;

    // An upcoming call gated behind ENTITLEMENT, carrying a real meet link and
    // recording URL that must only reach the entitled member. The dashboard
    // returns just the 3 *earliest* future calls, and the shared dev DB seeds
    // its soonest call ~24h out ("tomorrow"), so schedule this one only seconds
    // ahead — that keeps it the earliest future call and guarantees it lands in
    // the response regardless of other seeded data.
    const future = new Date(Date.now() + 30 * 1000);
    const [call] = await db
      .insert(coachingCallsTable)
      .values({
        title: `${PREFIX}-call`,
        description: "Locked upcoming coaching call",
        coachId,
        meetLink: MEET_LINK,
        scheduledAt: future,
        requiredEntitlement: ENTITLEMENT,
        recordingUrl: RECORDING_URL,
      })
      .returning({ id: coachingCallsTable.id });
    callId = call.id;
  });

  afterAll(async () => {
    if (callId) {
      await db.delete(coachingCallsTable).where(eq(coachingCallsTable.id, callId));
    }
    if (coachId) {
      await db.delete(coachesTable).where(eq(coachesTable.id, coachId));
    }
    if (userProductIds.length > 0) {
      await db.delete(userProductsTable).where(inArray(userProductsTable.id, userProductIds));
    }
    if (productId) {
      await db.delete(productsTable).where(eq(productsTable.id, productId));
    }
    await db.delete(usersTable).where(inArray(usersTable.id, [entitledUserId, lockedUserId]));
  });

  it("hides meetLink and recordingUrl for a member lacking the entitlement", async () => {
    const res = await request(app)
      .get("/api/dashboard")
      .set("Cookie", lockedCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.upcomingCalls)).toBe(true);

    const call = res.body.upcomingCalls.find((c: any) => c.title === `${PREFIX}-call`);
    expect(call).toBeDefined();
    expect(call.isAccessible).toBe(false);
    expect(call.meetLink).toBeNull();
    expect(call.recordingUrl).toBeNull();
  });

  it("exposes the real meetLink and recordingUrl for an entitled member", async () => {
    const res = await request(app)
      .get("/api/dashboard")
      .set("Cookie", entitledCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.upcomingCalls)).toBe(true);

    const call = res.body.upcomingCalls.find((c: any) => c.title === `${PREFIX}-call`);
    expect(call).toBeDefined();
    expect(call.isAccessible).toBe(true);
    expect(call.meetLink).toBe(MEET_LINK);
    expect(call.recordingUrl).toBe(RECORDING_URL);
  });
});
