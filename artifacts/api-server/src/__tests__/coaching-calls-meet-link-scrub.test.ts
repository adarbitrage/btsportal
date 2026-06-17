import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import coachingRouter from "../routes/coaching";
import dashboardRouter from "../routes/dashboard";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `coaching-scrub-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;

interface TierFixture {
  userId: number;
  cookie: string;
}

const fixtures: Record<"frontend" | "threeMonth" | "lifetime", TierFixture> = {
  frontend: { userId: 0, cookie: "" },
  threeMonth: { userId: 0, cookie: "" },
  lifetime: { userId: 0, cookie: "" },
};

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
let seededCoachId = 0;
let groupCallId = 0;
let mastermindCallId = 0;

const REAL_GROUP_LINK = "https://meet.google.com/group-real-xyz";
const REAL_GROUP_RECORDING = "https://recordings.example/group-001.mp4";
const REAL_MASTERMIND_LINK = "https://meet.google.com/mastermind-real-abc";
const REAL_MASTERMIND_RECORDING = "https://recordings.example/mastermind-001.mp4";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function makeUser(label: string, entitlementKeys: string[]): Promise<TierFixture> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-${label}@example.test`,
      name: `Tier ${label} member`,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(user.id);

  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TAG}-product-${label}`,
      name: `${label} test product`,
      type: "backend",
      // Real JSONB array (not a JSON-encoded string scalar) so this test is
      // independent of the products.entitlement_keys storage-shape bug.
      entitlementKeys: entitlementKeys as unknown as string[],
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);

  await db.insert(userProductsTable).values({
    userId: user.id,
    productId: product.id,
    status: "active",
  });

  return { userId: user.id, cookie: signCookie(user.id, user.email) };
}

beforeAll(async () => {
  app = buildTestAppWithRouters([coachingRouter, dashboardRouter]);

  // Front-End: no coaching entitlements at all.
  fixtures.frontend = await makeUser("frontend", ["content:frontend", "support:basic"]);
  // 3-Month: group only, no mastermind.
  fixtures.threeMonth = await makeUser("threeMonth", [
    "content:frontend",
    "coaching:group",
    "support:enhanced",
  ]);
  // Lifetime: both group AND mastermind.
  fixtures.lifetime = await makeUser("lifetime", [
    "content:frontend",
    "coaching:group",
    "coaching:mastermind",
    "access:lifetime",
    "support:vip",
  ]);

  const [coach] = await db
    .insert(coachesTable)
    .values({
      name: `${TAG} coach`,
      bio: "Test coach",
      specialties: "test",
      callTypes: ["weekly_qa", "mastermind"],
    })
    .returning({ id: coachesTable.id });
  seededCoachId = coach.id;

  const futureGroup = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const futureMaster = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

  const [groupCall] = await db
    .insert(coachingCallsTable)
    .values({
      title: `${TAG} group call`,
      description: "Open Q&A",
      callType: "weekly_qa",
      coachId: coach.id,
      meetLink: REAL_GROUP_LINK,
      recordingUrl: REAL_GROUP_RECORDING,
      scheduledAt: futureGroup,
      durationMinutes: 60,
      requiredEntitlement: "coaching:group",
    })
    .returning({ id: coachingCallsTable.id });
  groupCallId = groupCall.id;

  const [masterCall] = await db
    .insert(coachingCallsTable)
    .values({
      title: `${TAG} mastermind call`,
      description: "Mastermind deep dive",
      callType: "mastermind",
      coachId: coach.id,
      meetLink: REAL_MASTERMIND_LINK,
      recordingUrl: REAL_MASTERMIND_RECORDING,
      scheduledAt: futureMaster,
      durationMinutes: 90,
      requiredEntitlement: "coaching:mastermind",
    })
    .returning({ id: coachingCallsTable.id });
  mastermindCallId = masterCall.id;
});

afterAll(async () => {
  if (groupCallId || mastermindCallId) {
    await db
      .delete(coachingCallsTable)
      .where(inArray(coachingCallsTable.id, [groupCallId, mastermindCallId].filter(Boolean)));
  }
  if (seededCoachId) {
    await db.delete(coachesTable).where(inArray(coachesTable.id, [seededCoachId]));
  }
  if (seededUserIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
});

interface ResponseCall {
  id: number;
  isAccessible: boolean;
  meetLink: string | null;
  recordingUrl: string | null;
}

function pick(body: ResponseCall[], id: number): ResponseCall {
  const row = body.find((c) => c.id === id);
  if (!row) throw new Error(`call ${id} missing from response`);
  return row;
}

describe("GET /api/coaching-calls — meet link & recording scrub", () => {
  it("Front-End member sees both calls but every meetLink and recordingUrl is null", async () => {
    const res = await request(app)
      .get("/api/coaching-calls")
      .set("Cookie", fixtures.frontend.cookie);
    expect(res.status).toBe(200);

    const group = pick(res.body, groupCallId);
    const master = pick(res.body, mastermindCallId);

    expect(group.isAccessible).toBe(false);
    expect(group.meetLink).toBeNull();
    expect(group.recordingUrl).toBeNull();

    expect(master.isAccessible).toBe(false);
    expect(master.meetLink).toBeNull();
    expect(master.recordingUrl).toBeNull();

    // Belt-and-suspenders: the raw JSON body must not contain either real link
    // anywhere — guards against a future field being added that re-leaks them.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(REAL_GROUP_LINK);
    expect(raw).not.toContain(REAL_GROUP_RECORDING);
    expect(raw).not.toContain(REAL_MASTERMIND_LINK);
    expect(raw).not.toContain(REAL_MASTERMIND_RECORDING);
  });

  it("3-Month member sees real values for the group call and null for the mastermind call", async () => {
    const res = await request(app)
      .get("/api/coaching-calls")
      .set("Cookie", fixtures.threeMonth.cookie);
    expect(res.status).toBe(200);

    const group = pick(res.body, groupCallId);
    const master = pick(res.body, mastermindCallId);

    expect(group.isAccessible).toBe(true);
    expect(group.meetLink).toBe(REAL_GROUP_LINK);
    expect(group.recordingUrl).toBe(REAL_GROUP_RECORDING);

    expect(master.isAccessible).toBe(false);
    expect(master.meetLink).toBeNull();
    expect(master.recordingUrl).toBeNull();

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(REAL_MASTERMIND_LINK);
    expect(raw).not.toContain(REAL_MASTERMIND_RECORDING);
  });

  it("Lifetime member sees real meetLink and recordingUrl for every call", async () => {
    const res = await request(app)
      .get("/api/coaching-calls")
      .set("Cookie", fixtures.lifetime.cookie);
    expect(res.status).toBe(200);

    const group = pick(res.body, groupCallId);
    const master = pick(res.body, mastermindCallId);

    expect(group.isAccessible).toBe(true);
    expect(group.meetLink).toBe(REAL_GROUP_LINK);
    expect(group.recordingUrl).toBe(REAL_GROUP_RECORDING);

    expect(master.isAccessible).toBe(true);
    expect(master.meetLink).toBe(REAL_MASTERMIND_LINK);
    expect(master.recordingUrl).toBe(REAL_MASTERMIND_RECORDING);
  });

  it("GET /api/dashboard.upcomingCalls also scrubs meetLink and recordingUrl for non-entitled members", async () => {
    // Same vulnerability lives on the dashboard endpoint, which surfaces the
    // next 3 upcoming calls. Verify the same scrub applies there.
    const frontendRes = await request(app)
      .get("/api/dashboard")
      .set("Cookie", fixtures.frontend.cookie);
    expect(frontendRes.status).toBe(200);

    const frontendCalls: ResponseCall[] = frontendRes.body.upcomingCalls;
    const frontendMaster = frontendCalls.find((c) => c.id === mastermindCallId);
    const frontendGroup = frontendCalls.find((c) => c.id === groupCallId);
    if (frontendMaster) {
      expect(frontendMaster.isAccessible).toBe(false);
      expect(frontendMaster.meetLink).toBeNull();
      expect(frontendMaster.recordingUrl).toBeNull();
    }
    if (frontendGroup) {
      expect(frontendGroup.isAccessible).toBe(false);
      expect(frontendGroup.meetLink).toBeNull();
      expect(frontendGroup.recordingUrl).toBeNull();
    }

    const rawFrontend = JSON.stringify(frontendRes.body.upcomingCalls);
    expect(rawFrontend).not.toContain(REAL_GROUP_LINK);
    expect(rawFrontend).not.toContain(REAL_GROUP_RECORDING);
    expect(rawFrontend).not.toContain(REAL_MASTERMIND_LINK);
    expect(rawFrontend).not.toContain(REAL_MASTERMIND_RECORDING);

    const lifetimeRes = await request(app)
      .get("/api/dashboard")
      .set("Cookie", fixtures.lifetime.cookie);
    expect(lifetimeRes.status).toBe(200);

    const lifetimeCalls: ResponseCall[] = lifetimeRes.body.upcomingCalls;
    const lifetimeGroup = lifetimeCalls.find((c) => c.id === groupCallId);
    const lifetimeMaster = lifetimeCalls.find((c) => c.id === mastermindCallId);
    if (lifetimeGroup) {
      expect(lifetimeGroup.isAccessible).toBe(true);
      expect(lifetimeGroup.meetLink).toBe(REAL_GROUP_LINK);
      expect(lifetimeGroup.recordingUrl).toBe(REAL_GROUP_RECORDING);
    }
    if (lifetimeMaster) {
      expect(lifetimeMaster.isAccessible).toBe(true);
      expect(lifetimeMaster.meetLink).toBe(REAL_MASTERMIND_LINK);
      expect(lifetimeMaster.recordingUrl).toBe(REAL_MASTERMIND_RECORDING);
    }
  });

  it("attaches an upgrade deep-link to locked calls and null to accessible ones", async () => {
    // The 3-Month member can join the group call (coaching:group) but not the
    // mastermind call (coaching:mastermind). Locked calls must carry an
    // upgradeUrl deep-linking to the plan that unlocks them; accessible calls
    // carry upgradeUrl: null. Keeps the card from being a dead-end (Task: Hide
    // upcoming-call shortcuts members can't actually join).
    const res = await request(app)
      .get("/api/coaching-calls")
      .set("Cookie", fixtures.threeMonth.cookie);
    expect(res.status).toBe(200);

    const group = pick(res.body, groupCallId) as unknown as { upgradeUrl: string | null };
    const master = pick(res.body, mastermindCallId) as unknown as { upgradeUrl: string | null };

    expect(group.upgradeUrl).toBeNull();
    // coaching:mastermind is first granted by the 6-month mentorship.
    expect(master.upgradeUrl).toBe("/plans?highlight=6month");
  });

  it("non-display fields (title, description, scheduledAt, coachName, duration) are still present on locked calls", async () => {
    const res = await request(app)
      .get("/api/coaching-calls")
      .set("Cookie", fixtures.frontend.cookie);
    expect(res.status).toBe(200);

    const master = pick(res.body, mastermindCallId);
    // These four must survive the scrub so the UI can still show a locked card.
    expect(master).toMatchObject({
      title: `${TAG} mastermind call`,
      description: "Mastermind deep dive",
      durationMinutes: 90,
      callType: "mastermind",
    });
    expect((master as unknown as { coachName: string }).coachName).toBe(`${TAG} coach`);
    expect((master as unknown as { scheduledAt: string }).scheduledAt).toBeTypeOf("string");
  });
});
