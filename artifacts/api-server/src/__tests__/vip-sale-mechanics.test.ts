/**
 * Tests for the VIP status product's composed-grant sale mechanics
 * (Task #1660). VIP is never sold standalone: an admin grants `vip`
 * (730-day status clock) + `1year` (365-day mentorship clock) in one
 * sitting via insertUserProductGrant, and a later `lifetime` grant is a
 * separate upsell. The two clocks run fully independently — see
 * loadVipInfoByMember in routes/partner-dashboard.ts and the expiry sweep
 * in routes/admin-expiration.ts for the two places that read this union.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import request from "supertest";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  partnersTable,
  partnerAssignmentsTable,
  onboardingEffectsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

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

import { insertUserProductGrant } from "../lib/external-grant-product";
import { getActiveAssignment } from "../lib/partner-assignment";
import { resolveOnboardingVariant } from "../lib/onboarding-variant";
import { seedVipProduct } from "../lib/seed-vip-product";
import { buildTestAppWithRouters } from "./test-app";
import adminExpirationRouter from "../routes/admin-expiration";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `vip-mechanics-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
const seededPartnerIds: number[] = [];

let vipProductId: number;
let oneYearProductId: number;
let lifetimeProductId: number;
let superAdminCookie: string;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(suffix: string): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-${suffix}@example.test`,
      name: `Test ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: "vip",
      emailVerified: true,
      onboardingComplete: true,
      onboardingVariant: "none",
      onboardingStep: 1,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function insertSuperAdmin(suffix: string): Promise<{ id: number; cookie: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, cookie: signCookie(row.id, email) };
}

async function insertPartner(suffix: string, isActive = true): Promise<number> {
  const [row] = await db
    .insert(partnersTable)
    .values({ displayName: `Partner ${suffix} ${TEST_TAG}`, isActive })
    .returning({ id: partnersTable.id });
  seededPartnerIds.push(row.id);
  return row.id;
}

/** Deactivate every other active partner so round-robin picks stay isolated. */
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

let app: ReturnType<typeof buildTestAppWithRouters>;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  app = buildTestAppWithRouters([adminExpirationRouter]);

  // Boot-seeding only runs on server startup; ensure the vip product exists
  // for a fresh test DB (idempotent, matches production behavior).
  await seedVipProduct();

  const [vip] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, "vip")).limit(1);
  const [oneYear] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, "1year")).limit(1);
  const [lifetime] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, "lifetime")).limit(1);
  expect(vip).toBeDefined();
  expect(oneYear).toBeDefined();
  expect(lifetime).toBeDefined();
  vipProductId = vip.id;
  oneYearProductId = oneYear.id;
  lifetimeProductId = lifetime.id;

  const admin = await insertSuperAdmin("expiration-runner");
  superAdminCookie = admin.cookie;
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(partnerAssignmentsTable).where(inArray(partnerAssignmentsTable.memberId, seededUserIds));
    await db.delete(onboardingEffectsTable).where(inArray(onboardingEffectsTable.userId, seededUserIds));
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededPartnerIds.length > 0) {
    await db.delete(partnersTable).where(inArray(partnersTable.id, seededPartnerIds));
  }
});

// ---------------------------------------------------------------------------
// 6a — admin-granting vip + 1year in sequence fires the onboarding upgrade
// hook and partner assignment exactly once each (from the 1year grant; vip
// itself is partner-ineligible and never fires a second assignment).
// ---------------------------------------------------------------------------

describe("6a: composed vip + 1year grant sequence", () => {
  it("elevates onboarding to 'full' once and assigns a partner exactly once", async () => {
    const partnerId = await insertPartner("6a");
    await withOnlyThesePartnersActive([partnerId], async () => {
      const memberId = await insertUser("6a-member");

      // Admin grants vip first (Products tab order is not load-bearing).
      await insertUserProductGrant({ userId: memberId, productId: vipProductId, durationDays: 730 });
      const afterVip = await db.select({ onboardingVariant: usersTable.onboardingVariant }).from(usersTable).where(eq(usersTable.id, memberId)).limit(1);
      expect(afterVip[0]?.onboardingVariant).toBe("none");
      expect(await getActiveAssignment(memberId)).toBeNull();

      // Then 1year — this is the grant that actually elevates onboarding and
      // triggers partner round-robin (vip alone does neither).
      await insertUserProductGrant({ userId: memberId, productId: oneYearProductId, durationDays: 365 });

      const afterOneYear = await db
        .select({ onboardingVariant: usersTable.onboardingVariant, onboardingComplete: usersTable.onboardingComplete })
        .from(usersTable)
        .where(eq(usersTable.id, memberId))
        .limit(1);
      expect(afterOneYear[0]?.onboardingVariant).toBe("full");
      expect(afterOneYear[0]?.onboardingComplete).toBe(false);

      const assignment = await getActiveAssignment(memberId);
      expect(assignment).not.toBeNull();

      // Exactly one active assignment row — no duplicate assignment fired.
      const allAssignments = await db
        .select({ id: partnerAssignmentsTable.id })
        .from(partnerAssignmentsTable)
        .where(eq(partnerAssignmentsTable.memberId, memberId));
      expect(allAssignments.length).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 6c — simulated 1year expiry with vip still active ends mentorship
// entitlements (onboarding variant recompute) and partner assignment, while
// vip:status and the (separately-sourced) VIP badge persist.
// ---------------------------------------------------------------------------

describe("6c: 1year expiry while vip remains active", () => {
  it("ends partner assignment and drops onboarding variant to 'none' while vip:status survives", async () => {
    const partnerId = await insertPartner("6c");
    await withOnlyThesePartnersActive([partnerId], async () => {
      const memberId = await insertUser("6c-member");
      await insertUserProductGrant({ userId: memberId, productId: vipProductId, durationDays: 730 });
      await insertUserProductGrant({ userId: memberId, productId: oneYearProductId, durationDays: 365 });
      expect(await getActiveAssignment(memberId)).not.toBeNull();

      // Simulate the 1year grant having lapsed (backdate its expiry, as the
      // real sweep would find it after 365 days) and run the same expiration
      // sweep the admin route uses.
      await db
        .update(userProductsTable)
        .set({ expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
        .where(and(eq(userProductsTable.userId, memberId), eq(userProductsTable.productId, oneYearProductId)));

      const res = await request(app).post("/api/admin/run-expiration-check").set("Cookie", superAdminCookie);
      expect(res.status).toBe(200);

      // Mentorship-derived state: partner assignment ended, onboarding variant
      // re-resolves to "none" since vip carries no rank-2+ entitlement.
      expect(await getActiveAssignment(memberId)).toBeNull();
      expect(await resolveOnboardingVariant(memberId)).toBe("none");

      // vip:status itself must still be active and unexpired.
      const [vipRow] = await db
        .select({ status: userProductsTable.status, expiresAt: userProductsTable.expiresAt })
        .from(userProductsTable)
        .where(and(eq(userProductsTable.userId, memberId), eq(userProductsTable.productId, vipProductId)))
        .limit(1);
      expect(vipRow?.status).toBe("active");
      expect(vipRow?.expiresAt).not.toBeNull();
      expect(vipRow!.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });
  });
});

// ---------------------------------------------------------------------------
// 6d — granting lifetime to an existing vip+1year member elevates content
// access (levelRank/onboarding variant already at "full" via 1year, so
// lifetime is a same-or-lower onboarding bucket) with no forced onboarding
// re-entry and no duplicate partner assignment (lifetime is also partner-
// eligible but assignRoundRobin is a no-op once an active assignment exists).
// ---------------------------------------------------------------------------

describe("6d: lifetime upsell onto an existing vip + 1year member", () => {
  it("does not re-open onboarding or create a second partner assignment", async () => {
    const partnerId = await insertPartner("6d");
    await withOnlyThesePartnersActive([partnerId], async () => {
      const memberId = await insertUser("6d-member");
      await insertUserProductGrant({ userId: memberId, productId: vipProductId, durationDays: 730 });
      await insertUserProductGrant({ userId: memberId, productId: oneYearProductId, durationDays: 365 });

      const before = await db
        .select({ onboardingVariant: usersTable.onboardingVariant, onboardingComplete: usersTable.onboardingComplete, onboardingStep: usersTable.onboardingStep })
        .from(usersTable)
        .where(eq(usersTable.id, memberId))
        .limit(1);
      expect(before[0]?.onboardingVariant).toBe("full");

      // Mark onboarding complete to prove lifetime doesn't force re-entry.
      await db.update(usersTable).set({ onboardingComplete: true, onboardingStep: 6 }).where(eq(usersTable.id, memberId));

      const assignmentBefore = await getActiveAssignment(memberId);
      expect(assignmentBefore).not.toBeNull();

      await insertUserProductGrant({ userId: memberId, productId: lifetimeProductId, durationDays: null });

      const after = await db
        .select({ onboardingVariant: usersTable.onboardingVariant, onboardingComplete: usersTable.onboardingComplete })
        .from(usersTable)
        .where(eq(usersTable.id, memberId))
        .limit(1);
      // Still "full" (lifetime does not add a new onboarding bucket above
      // full) and onboardingComplete stays true — no forced re-entry.
      expect(after[0]?.onboardingVariant).toBe("full");
      expect(after[0]?.onboardingComplete).toBe(true);

      const assignmentAfter = await getActiveAssignment(memberId);
      expect(assignmentAfter?.partnerId).toBe(assignmentBefore?.partnerId);

      const allAssignments = await db
        .select({ id: partnerAssignmentsTable.id })
        .from(partnerAssignmentsTable)
        .where(and(eq(partnerAssignmentsTable.memberId, memberId), eq(partnerAssignmentsTable.status, "active")));
      expect(allAssignments.length).toBe(1);
    });
  });
});
