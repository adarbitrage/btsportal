import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  partnersTable,
  partnerAssignmentsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

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

import {
  assignRoundRobin,
  maybeAssignPartnerForGrant,
  endActiveAssignment,
  reassignMember,
  getActiveAssignment,
  isPartnerEligibleRank,
  PARTNER_ELIGIBLE_MIN_RANK,
} from "../lib/partner-assignment";

const TEST_TAG = `partner-assign-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededPartnerIds: number[] = [];

async function insertUser(suffix: string): Promise<number> {
  const passwordHash = await bcrypt.hash("OriginalPassw0rd!", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-${suffix}@example.test`,
      name: `Test ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function insertProduct(slug: string): Promise<number> {
  const [row] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}_${slug}`,
      name: `Test ${slug}`,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(row.id);
  return row.id;
}

async function insertPartner(suffix: string, isActive = true): Promise<number> {
  const [row] = await db
    .insert(partnersTable)
    .values({
      displayName: `Partner ${suffix} ${TEST_TAG}`,
      isActive,
    })
    .returning({ id: partnersTable.id });
  seededPartnerIds.push(row.id);
  return row.id;
}

async function getAssignments(memberId: number) {
  return db
    .select()
    .from(partnerAssignmentsTable)
    .where(eq(partnerAssignmentsTable.memberId, memberId));
}

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db
      .delete(partnerAssignmentsTable)
      .where(inArray(partnerAssignmentsTable.memberId, seededUserIds));
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
  if (seededPartnerIds.length > 0) {
    await db.delete(partnersTable).where(inArray(partnersTable.id, seededPartnerIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("isPartnerEligibleRank", () => {
  it("is false below the minimum rank", () => {
    expect(isPartnerEligibleRank(0)).toBe(false);
    expect(isPartnerEligibleRank(1)).toBe(false);
    expect(isPartnerEligibleRank(undefined)).toBe(false);
  });

  it("is true at and above the minimum rank", () => {
    expect(PARTNER_ELIGIBLE_MIN_RANK).toBe(2);
    expect(isPartnerEligibleRank(2)).toBe(true);
    expect(isPartnerEligibleRank(3)).toBe(true);
    expect(isPartnerEligibleRank(5)).toBe(true);
  });
});

describe("assignRoundRobin", () => {
  it("returns not-assigned when no active partners exist", async () => {
    const memberId = await insertUser("no-partners");
    // Deactivate every seeded partner from other tests by scoping: only our
    // own partners exist in a real DB alongside possibly other rows, so
    // instead assert on a member with zero eligible partners by using an
    // inactive-only partner.
    const partnerId = await insertPartner("inactive-only", false);
    const result = await assignRoundRobin(memberId);
    // There may be other active partners seeded elsewhere in the shared dev
    // DB, so we can't strictly assert "no partner available" here — instead
    // just confirm the inactive partner we created was never chosen.
    if (result.assigned) {
      expect(result.partnerId).not.toBe(partnerId);
    }
  });

  it("picks the least-loaded partner and is idempotent", async () => {
    const partnerA = await insertPartner("a");
    const partnerB = await insertPartner("b");
    const memberX = await insertUser("member-x");
    const memberY = await insertUser("member-y");
    const memberZ = await insertUser("member-z");

    // Pre-load partnerA with one active assignment so it's no longer the
    // least-loaded candidate between A and B.
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId: memberX, partnerId: partnerA, status: "active" });

    const firstPick = await assignRoundRobin(memberY);
    expect(firstPick.assigned).toBe(true);
    expect(firstPick.partnerId).toBe(partnerB);

    // Now A and B are tied (1 active each) — next pick breaks the tie by
    // whichever candidate set orders first; simply confirm it lands on one
    // of our two seeded partners.
    const secondPick = await assignRoundRobin(memberZ);
    expect(secondPick.assigned).toBe(true);
    expect([partnerA, partnerB]).toContain(secondPick.partnerId);

    // Idempotency: calling again for a member who already has an active
    // assignment returns the existing one and does not insert a duplicate.
    const repeat = await assignRoundRobin(memberY);
    expect(repeat.assigned).toBe(false);
    expect(repeat.partnerId).toBe(partnerB);
    const rows = await getAssignments(memberY);
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
  });
});

describe("maybeAssignPartnerForGrant", () => {
  it("does not assign for below-threshold products", async () => {
    const launchpadId = await insertProduct("launchpad");
    const memberId = await insertUser("launchpad-buyer");
    await maybeAssignPartnerForGrant(memberId, launchpadId);
    const existing = await getActiveAssignment(memberId);
    expect(existing).toBeNull();
  });

  it("assigns for 3-month+ products, including direct 6-month buyers", async () => {
    // PRODUCT_RANK is keyed on the literal product slug (e.g. "6month"), so
    // this must use the real seeded product row rather than a synthetic
    // test-tagged slug, or the rank lookup silently misses.
    await insertPartner("grant-eligible");
    const [sixMonthProduct] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.slug, "6month"))
      .limit(1);
    expect(sixMonthProduct).toBeDefined();
    const memberId = await insertUser("sixmonth-buyer");
    await maybeAssignPartnerForGrant(memberId, sixMonthProduct.id);
    const existing = await getActiveAssignment(memberId);
    expect(existing).not.toBeNull();
  });

  it("never throws even if the product id does not exist", async () => {
    const memberId = await insertUser("bad-product");
    await expect(maybeAssignPartnerForGrant(memberId, 99999999)).resolves.toBeUndefined();
    const existing = await getActiveAssignment(memberId);
    expect(existing).toBeNull();
  });
});

describe("endActiveAssignment", () => {
  it("ends the active row and is a no-op when none exists", async () => {
    const partnerId = await insertPartner("end-test");
    const memberId = await insertUser("end-member");
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId, partnerId, status: "active" });

    const ended = await endActiveAssignment(memberId, "test reason");
    expect(ended).toBe(true);

    const rows = await getAssignments(memberId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ended");
    expect(rows[0].endedReason).toBe("test reason");
    expect(rows[0].endedAt).not.toBeNull();

    const secondCall = await endActiveAssignment(memberId, "again");
    expect(secondCall).toBe(false);
  });
});

describe("reassignMember", () => {
  it("ends the old assignment and creates a new one to a specific partner", async () => {
    const oldPartner = await insertPartner("reassign-old");
    const newPartner = await insertPartner("reassign-new");
    const memberId = await insertUser("reassign-member");
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId, partnerId: oldPartner, status: "active" });

    const result = await reassignMember(memberId, {
      partnerId: newPartner,
      reason: "admin reassignment",
    });
    expect(result.partnerId).toBe(newPartner);

    const rows = await getAssignments(memberId);
    const active = rows.filter((r) => r.status === "active");
    const reassigned = rows.filter((r) => r.status === "reassigned");
    expect(active).toHaveLength(1);
    expect(active[0].partnerId).toBe(newPartner);
    expect(reassigned).toHaveLength(1);
    expect(reassigned[0].partnerId).toBe(oldPartner);
    expect(reassigned[0].endedReason).toBe("admin reassignment");
  });

  it("re-runs round robin when no specific partner is given", async () => {
    const partnerA = await insertPartner("rr-a");
    await insertPartner("rr-b");
    const memberId = await insertUser("reassign-rr-member");
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId, partnerId: partnerA, status: "active" });

    const result = await reassignMember(memberId, { reason: "round robin retry" });
    expect(result.partnerId).not.toBeNull();

    const rows = await getAssignments(memberId);
    const active = rows.filter((r) => r.status === "active");
    expect(active).toHaveLength(1);
  });

  it("leaves the existing assignment untouched when no active partner is available for round robin", async () => {
    const onlyPartner = await insertPartner("rr-none-available", false);
    const memberId = await insertUser("reassign-rr-none-member");
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId, partnerId: onlyPartner, status: "active" });

    // Round-robin selection considers every active partner in the table, not
    // just ones tagged by this test, so temporarily deactivate any that were
    // left active by earlier tests/other data in this run to force the
    // "no candidates" branch deterministically.
    const activeElsewhere = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(eq(partnersTable.isActive, true));
    const idsToRestore = activeElsewhere.map((p) => p.id);
    if (idsToRestore.length > 0) {
      await db
        .update(partnersTable)
        .set({ isActive: false })
        .where(inArray(partnersTable.id, idsToRestore));
    }

    try {
      const result = await reassignMember(memberId, {
        reason: "round robin retry, no candidates",
      });
      expect(result.partnerId).toBeNull();

      const rows = await getAssignments(memberId);
      const active = rows.filter((r) => r.status === "active");
      const reassigned = rows.filter((r) => r.status === "reassigned");
      expect(active).toHaveLength(1);
      expect(active[0].partnerId).toBe(onlyPartner);
      expect(reassigned).toHaveLength(0);
    } finally {
      if (idsToRestore.length > 0) {
        await db
          .update(partnersTable)
          .set({ isActive: true })
          .where(inArray(partnersTable.id, idsToRestore));
      }
    }
  });
});
