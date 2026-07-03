/**
 * Task #1658 step 6 — confirm-gated repair endpoint for members whose
 * historical grant bypassed the shared seam. Covers:
 *  - auth (no key -> 401)
 *  - dry-run reports candidates without writing anything
 *  - confirmed run repairs a non-grandfathered candidate (onboarding
 *    re-entry + partner assignment) and is idempotent on replay
 *  - grandfathered=true rows are ALWAYS skipped, even when confirmed
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  partnersTable,
  partnerAssignmentsTable,
  auditLogTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const OPS_KEY = `test-ops-key-${randomUUID().slice(0, 8)}`;

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => "job_test_id"),
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: vi.fn(async () => ({ result: "queued" as const })),
    queueSms: vi.fn(async () => ({ result: "queued" as const })),
  },
}));

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestApp } from "./test-app";
import opsRouter from "../routes/ops";
import { __resetOpsRateLimitStateForTests } from "../middleware/ops-rate-limit";

const TEST_TAG = `ops-onboarding-repair-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestApp>;

const seededUserIds: number[] = [];
const seededPartnerIds: number[] = [];

let threeMonthProductId: number;

function authHeaders() {
  return { Authorization: `Bearer ${OPS_KEY}` };
}

async function insertMember(suffix: string, opts: { grandfathered?: boolean } = {}): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-${suffix}@example.test`,
      name: `Ops Repair Test ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: null,
      emailVerified: true,
      onboardingVariant: "none",
      onboardingComplete: true,
      onboardingStep: 1,
      grandfathered: opts.grandfathered ?? false,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function grantBypassedProduct(userId: number, productId: number): Promise<void> {
  // Simulates the historical bypass: a raw insert into user_products with no
  // hooks fired, exactly what the pre-fix admin route / GHL handler did.
  await db.insert(userProductsTable).values({ userId, productId, status: "active" });
}

async function insertPartner(suffix: string): Promise<number> {
  const [row] = await db
    .insert(partnersTable)
    .values({ displayName: `Ops Repair Partner ${suffix} ${TEST_TAG}`, isActive: true })
    .returning({ id: partnersTable.id });
  seededPartnerIds.push(row.id);
  return row.id;
}

async function getUser(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
}

async function withOnlyThesePartnersActive<T>(partnerIds: number[], fn: () => Promise<T>): Promise<T> {
  const active = await db.select({ id: partnersTable.id }).from(partnersTable).where(eq(partnersTable.isActive, true));
  const otherIds = active.map((p) => p.id).filter((id) => !partnerIds.includes(id));
  if (otherIds.length > 0) {
    await db.update(partnersTable).set({ isActive: false }).where(inArray(partnersTable.id, otherIds));
  }
  try {
    return await fn();
  } finally {
    if (otherIds.length > 0) {
      await db.update(partnersTable).set({ isActive: true }).where(inArray(partnersTable.id, otherIds));
    }
  }
}

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  process.env.OPS_API_KEY = OPS_KEY;
  app = buildTestApp({ routers: [opsRouter] });

  const [threeMonth] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, "3month"));
  if (!threeMonth) {
    throw new Error("Expected dev-seeded '3month' product to exist for ops-onboarding-grant-repair tests");
  }
  threeMonthProductId = threeMonth.id;
});

afterAll(async () => {
  delete process.env.OPS_API_KEY;
  if (seededUserIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(partnerAssignmentsTable).where(inArray(partnerAssignmentsTable.memberId, seededUserIds));
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
  }
  if (seededPartnerIds.length > 0) {
    await db.delete(partnersTable).where(inArray(partnersTable.id, seededPartnerIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /api/ops/onboarding/repair-admin-grants — auth", () => {
  it("401s without a key", async () => {
    const res = await request(app).post("/api/ops/onboarding/repair-admin-grants").send({});
    expect(res.status).toBe(401);
  });

  it("401s with a wrong key", async () => {
    const res = await request(app)
      .post("/api/ops/onboarding/repair-admin-grants")
      .set("Authorization", "Bearer wrong-key")
      .send({});
    expect(res.status).toBe(401);
  });
});

describe("POST /api/ops/onboarding/repair-admin-grants — dry-run + confirmed repair", () => {
  it("dry-run reports the bypassed grant as a candidate without writing anything", async () => {
    __resetOpsRateLimitStateForTests();
    const memberId = await insertMember("dryrun");
    await grantBypassedProduct(memberId, threeMonthProductId);

    const res = await request(app)
      .post("/api/ops/onboarding/repair-admin-grants")
      .set(authHeaders())
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);

    const candidate = res.body.repairCandidates.find((c: { userId: number }) => c.userId === memberId);
    expect(candidate).toBeTruthy();
    expect(candidate.persistedVariant).toBe("none");
    expect(candidate.resolvedVariant).toBe("full");
    expect(candidate.wouldAssignPartner).toBe(true);

    // Dry-run must not have written anything.
    const after = await getUser(memberId);
    expect(after.onboardingVariant).toBe("none");
    expect(after.onboardingComplete).toBe(true);
  });

  it("confirmed run repairs a non-grandfathered candidate and is idempotent on replay", async () => {
    __resetOpsRateLimitStateForTests();
    const partnerId = await insertPartner("confirm");
    await withOnlyThesePartnersActive([partnerId], async () => {
      const memberId = await insertMember("confirm");
      await grantBypassedProduct(memberId, threeMonthProductId);

      const first = await request(app)
        .post("/api/ops/onboarding/repair-admin-grants")
        .set(authHeaders())
        .send({ confirm: true });
      expect(first.status).toBe(200);
      expect(first.body.dryRun).toBe(false);
      const repairedEntry = first.body.repaired.find((r: { userId: number }) => r.userId === memberId);
      expect(repairedEntry).toBeTruthy();
      expect(repairedEntry.onboardingVariantAfter).toBe("full");
      expect(repairedEntry.partnerAssigned).toBe(true);

      const after = await getUser(memberId);
      expect(after.onboardingVariant).toBe("full");
      expect(after.onboardingComplete).toBe(false);

      const assignments = await db
        .select()
        .from(partnerAssignmentsTable)
        .where(eq(partnerAssignmentsTable.memberId, memberId));
      expect(assignments).toHaveLength(1);

      // Replaying confirm must be a no-op: the member is no longer a
      // candidate (variant already elevated), and re-running assignRoundRobin
      // for an existing assignment must never insert a second row.
      __resetOpsRateLimitStateForTests();
      const second = await request(app)
        .post("/api/ops/onboarding/repair-admin-grants")
        .set(authHeaders())
        .send({ confirm: true });
      expect(second.status).toBe(200);
      const stillCandidate = second.body.repaired.find((r: { userId: number }) => r.userId === memberId);
      expect(stillCandidate).toBeFalsy();

      const assignmentsAfterReplay = await db
        .select()
        .from(partnerAssignmentsTable)
        .where(eq(partnerAssignmentsTable.memberId, memberId));
      expect(assignmentsAfterReplay).toHaveLength(1);
    });
  });

  it("never touches a grandfathered=true candidate, in dry-run or confirmed mode", async () => {
    __resetOpsRateLimitStateForTests();
    const memberId = await insertMember("grandfathered", { grandfathered: true });
    await grantBypassedProduct(memberId, threeMonthProductId);

    const dryRun = await request(app)
      .post("/api/ops/onboarding/repair-admin-grants")
      .set(authHeaders())
      .send({});
    expect(dryRun.status).toBe(200);
    expect(dryRun.body.repairCandidates.some((c: { userId: number }) => c.userId === memberId)).toBe(false);
    const skipped = dryRun.body.grandfatheredSkipped.find((c: { userId: number }) => c.userId === memberId);
    expect(skipped).toBeTruthy();

    __resetOpsRateLimitStateForTests();
    const confirmed = await request(app)
      .post("/api/ops/onboarding/repair-admin-grants")
      .set(authHeaders())
      .send({ confirm: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.repaired.some((r: { userId: number }) => r.userId === memberId)).toBe(false);

    const after = await getUser(memberId);
    expect(after.onboardingVariant).toBe("none");
    expect(after.onboardingComplete).toBe(true);
  });
});
