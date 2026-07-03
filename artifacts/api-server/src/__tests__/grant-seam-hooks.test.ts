/**
 * Task #1658 — regression coverage proving the two previously-bypassing
 * grant call sites (admin member-detail grant route, GHL
 * `manual_upgrade_<slug>` webhook tag) now fire through the shared
 * `insertUserProductGrant` seam and therefore trigger BOTH post-grant hooks:
 * `maybeForceOnboardingReentry` (TB1 variant re-resolve) and
 * `maybeAssignPartnerForGrant` (round-robin accountability partner, 3-Month+
 * only). Also proves the hooks don't double-fire when a grant is repeated.
 */
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
  partnersTable,
  partnerAssignmentsTable,
  auditLogTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

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

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import { handleTagTrigger } from "../routes/webhooks-ghl";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `grant-seam-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;

const seededUserIds: number[] = [];
const seededPartnerIds: number[] = [];

let launchpadProductId: number;
let threeMonthProductId: number;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertMember(suffix: string): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-${suffix}@example.test`,
      name: `Grant Seam Test ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: null,
      emailVerified: true,
      onboardingVariant: "none",
      onboardingComplete: true,
      onboardingStep: 1,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function insertPartner(suffix: string): Promise<number> {
  const [row] = await db
    .insert(partnersTable)
    .values({ displayName: `Grant Seam Partner ${suffix} ${TEST_TAG}`, isActive: true })
    .returning({ id: partnersTable.id });
  seededPartnerIds.push(row.id);
  return row.id;
}

async function getUser(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
}

async function getAssignments(memberId: number) {
  return db.select().from(partnerAssignmentsTable).where(eq(partnerAssignmentsTable.memberId, memberId));
}

/**
 * Deactivates every currently-active partner except the given ids for the
 * duration of `fn` (same convention as partner-assignment.test.ts) so the
 * shared dev DB's real seeded roster can't make round-robin picks
 * non-deterministic.
 */
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

  app = buildTestAppWithRouters([adminPanelRouter]);

  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-admin@example.test`,
      name: "Grant Seam Admin",
      passwordHash,
      role: "admin",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(admin.id);
  adminCookie = signCookie(admin.id, admin.email);

  const [launchpad] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, "launchpad"));
  const [threeMonth] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, "3month"));
  if (!launchpad || !threeMonth) {
    throw new Error("Expected dev-seeded 'launchpad' and '3month' products to exist for grant-seam-hooks tests");
  }
  launchpadProductId = launchpad.id;
  threeMonthProductId = threeMonth.id;
});

afterAll(async () => {
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

describe("Admin grant-product route — routed through the shared seam", () => {
  it("LaunchPad grant fires onboarding re-entry but NOT partner assignment (below eligible rank)", async () => {
    const memberId = await insertMember("admin-launchpad");

    const res = await request(app)
      .post(`/api/admin/members/${memberId}/grant-product`)
      .set("Cookie", adminCookie)
      .send({ productId: launchpadProductId });
    expect(res.status).toBe(200);

    const after = await getUser(memberId);
    expect(after.onboardingVariant).toBe("launchpad");
    expect(after.onboardingComplete).toBe(false);

    const assignments = await getAssignments(memberId);
    expect(assignments).toHaveLength(0);
  });

  it("3-Month grant fires BOTH onboarding re-entry (-> full) and partner assignment", async () => {
    const partnerId = await insertPartner("admin-3month");
    await withOnlyThesePartnersActive([partnerId], async () => {
      const memberId = await insertMember("admin-3month");

      const res = await request(app)
        .post(`/api/admin/members/${memberId}/grant-product`)
        .set("Cookie", adminCookie)
        .send({ productId: threeMonthProductId });
      expect(res.status).toBe(200);

      const after = await getUser(memberId);
      expect(after.onboardingVariant).toBe("full");
      expect(after.onboardingComplete).toBe(false);

      const assignments = await getAssignments(memberId);
      expect(assignments).toHaveLength(1);
      expect(assignments[0].status).toBe("active");
      expect(assignments[0].partnerId).toBe(partnerId);
      expect(["soonest", "fallback_fewest_active"]).toContain(assignments[0].assignmentMethod);
    });
  });

  it("does not double-fire hooks on a repeated grant for the same product (409, no duplicate partner assignment)", async () => {
    const partnerId = await insertPartner("admin-nodup");
    await withOnlyThesePartnersActive([partnerId], async () => {
      const memberId = await insertMember("admin-nodup");

      const first = await request(app)
        .post(`/api/admin/members/${memberId}/grant-product`)
        .set("Cookie", adminCookie)
        .send({ productId: threeMonthProductId });
      expect(first.status).toBe(200);

      const second = await request(app)
        .post(`/api/admin/members/${memberId}/grant-product`)
        .set("Cookie", adminCookie)
        .send({ productId: threeMonthProductId });
      expect(second.status).toBe(409);

      const assignments = await getAssignments(memberId);
      expect(assignments.filter((a) => a.status === "active")).toHaveLength(1);
    });
  });
});

describe("GHL manual_upgrade_<slug> tag trigger — routed through the shared seam", () => {
  it("grants the product and fires onboarding re-entry + partner assignment for a 3-Month+ slug", async () => {
    const partnerId = await insertPartner("ghl-3month");
    await withOnlyThesePartnersActive([partnerId], async () => {
      const memberId = await insertMember("ghl-3month");
      const email = (await getUser(memberId)).email;

      const result = await handleTagTrigger("manual_upgrade_3month", email, "ghl-contact-id");
      expect(result.action).toBe("manual_upgrade");

      const after = await getUser(memberId);
      expect(after.onboardingVariant).toBe("full");
      expect(after.onboardingComplete).toBe(false);

      const grants = await db
        .select()
        .from(userProductsTable)
        .where(eq(userProductsTable.userId, memberId));
      expect(grants).toHaveLength(1);
      expect(grants[0].status).toBe("active");

      const assignments = await getAssignments(memberId);
      expect(assignments).toHaveLength(1);
      expect(assignments[0].partnerId).toBe(partnerId);
    });
  });

  it("is a no-op skip (not a raw double-grant) when the member already has an active grant for the slug", async () => {
    const memberId = await insertMember("ghl-existing");
    const email = (await getUser(memberId)).email;

    const first = await handleTagTrigger("manual_upgrade_launchpad", email, "ghl-contact-id");
    expect(first.action).toBe("manual_upgrade");

    const second = await handleTagTrigger("manual_upgrade_launchpad", email, "ghl-contact-id");
    expect(second.action).toBe("skipped");

    const grants = await db
      .select()
      .from(userProductsTable)
      .where(eq(userProductsTable.userId, memberId));
    expect(grants).toHaveLength(1);
  });
});
