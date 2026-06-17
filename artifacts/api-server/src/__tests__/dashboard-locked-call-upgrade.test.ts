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

// Behavior guard for the dashboard's upcoming-call upgrade path. The
// `/dashboard` handler keeps locked upcoming calls visible (links scrubbed) but
// attaches an `upgradeUrl` so members who can't join still see a clear path to
// the plan that unlocks the call (see `upcomingCallsMapped` /
// `CALL_ENTITLEMENT_TO_PLAN` in routes/dashboard.ts). These tests pin that:
//   - a locked member gets a deep-linked upgrade URL pointing at the lowest
//     plan that grants the call's entitlement, and
//   - an entitled member gets `upgradeUrl: null` (nothing to upgrade to).
// If a future change drops the upgrade plumbing, locked cards would become
// dead-ends again.

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
  const email = `dash-upg-${suffix}-${randomUUID().slice(0, 8)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Dash Upg ${suffix}`,
      passwordHash,
      role: "member",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  return { id: row.id, email };
}

describe("GET /dashboard upcoming-call upgrade path", () => {
  const PREFIX = `__dash_upg_test__${randomUUID().slice(0, 8)}`;
  // `coaching:group` is first granted by the 3-month mentorship, so the locked
  // member's upgrade URL must deep-link to that plan.
  const ENTITLEMENT = "coaching:group";
  const EXPECTED_PLAN = "3month";

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
        name: "Dash Upg Coaching Product",
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

    // Schedule the call only seconds ahead so it stays the earliest future call
    // and is guaranteed to land in the 3-call dashboard window regardless of
    // other seeded data.
    const future = new Date(Date.now() + 30 * 1000);
    const [call] = await db
      .insert(coachingCallsTable)
      .values({
        title: `${PREFIX}-call`,
        description: "Upcoming coaching call for upgrade-path test",
        coachId,
        meetLink: "https://meet.example.test/upg-call",
        scheduledAt: future,
        requiredEntitlement: ENTITLEMENT,
        recordingUrl: "https://rec.example.test/upg-call.mp4",
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

  it("gives a locked member a deep-linked upgrade URL for the call", async () => {
    const res = await request(app)
      .get("/api/dashboard")
      .set("Cookie", lockedCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.upcomingCalls)).toBe(true);

    const call = res.body.upcomingCalls.find((c: any) => c.title === `${PREFIX}-call`);
    expect(call).toBeDefined();
    // Locked members keep seeing the card, but it must point them at the plan
    // that unlocks it rather than being a dead-end.
    expect(call.isAccessible).toBe(false);
    expect(call.upgradeUrl).toBe(`/plans?highlight=${EXPECTED_PLAN}`);
  });

  it("returns a null upgrade URL for an entitled member", async () => {
    const res = await request(app)
      .get("/api/dashboard")
      .set("Cookie", entitledCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.upcomingCalls)).toBe(true);

    const call = res.body.upcomingCalls.find((c: any) => c.title === `${PREFIX}-call`);
    expect(call).toBeDefined();
    // Nothing to upgrade to — the member can already join.
    expect(call.isAccessible).toBe(true);
    expect(call.upgradeUrl).toBeNull();
  });
});
