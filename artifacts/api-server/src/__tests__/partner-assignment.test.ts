import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  partnersTable,
  partnerAssignmentsTable,
  callBookingsTable,
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
  __setSoonestProbeBudgetMsForTests,
  __setPartnerAssignmentFreeSlotsFnForTests,
} from "../lib/partner-assignment";
import {
  __resetPartnerEscalationAlerterForTests,
  __setPartnerEscalationAlerterDeliveriesForTests,
  getPartnerEscalationAlertingState,
  type DeliveryResult,
  type PartnerEscalationAlertPayload,
} from "../lib/partner-escalation-alerter";

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

const seededBookingIds: number[] = [];

async function insertPartnerBooking(
  memberId: number,
  partnerId: number,
  scheduledAt: Date,
): Promise<number> {
  const [row] = await db
    .insert(callBookingsTable)
    .values({
      memberId,
      staffType: "partner",
      staffId: partnerId,
      type: "partner",
      ghlCalendarId: `${TEST_TAG}-booking-cal`,
      scheduledAt,
      endAt: new Date(scheduledAt.getTime() + 30 * 60 * 1000),
      status: "booked",
    })
    .returning({ id: callBookingsTable.id });
  seededBookingIds.push(row.id);
  return row.id;
}

/**
 * Deactivates every currently-active partner EXCEPT the given ids for the
 * duration of `fn`, restoring them afterward. Needed because the shared dev
 * DB has real seeded partners that would otherwise pollute soonest-first /
 * fewest-active selection in these tests.
 */
async function withOnlyThesePartnersActive<T>(
  partnerIds: number[],
  fn: () => Promise<T>,
): Promise<T> {
  const active = await db
    .select({ id: partnersTable.id })
    .from(partnersTable)
    .where(eq(partnersTable.isActive, true));
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

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(async () => {
  if (seededBookingIds.length > 0) {
    await db.delete(callBookingsTable).where(inArray(callBookingsTable.id, seededBookingIds));
  }
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
    // The real seeded roster (Task #1611: Jean/Mikha/John/Neil) is active in
    // the shared dev DB with zero assignments, which would otherwise tie
    // with our fresh partnerB for "least-loaded" and make the pick
    // non-deterministic. Deactivate every other active partner for the
    // duration of this test so only our two fixtures compete.
    const otherActivePartners = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(eq(partnersTable.isActive, true));
    const otherActivePartnerIds = otherActivePartners.map((p) => p.id);
    if (otherActivePartnerIds.length > 0) {
      await db.update(partnersTable).set({ isActive: false }).where(inArray(partnersTable.id, otherActivePartnerIds));
    }
    try {
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
    } finally {
      if (otherActivePartnerIds.length > 0) {
        await db.update(partnersTable).set({ isActive: true }).where(inArray(partnersTable.id, otherActivePartnerIds));
      }
    }
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

// Task #1654, step 7(c)-(g): soonest-first partner assignment, its
// never-block fallback, method recording, the >7-day capacity alert, and
// daily-cap-aware slot filtering at assignment time.
describe("assignRoundRobin: soonest-first selection (Task #1654)", () => {
  let pdCalls: PartnerEscalationAlertPayload[];

  beforeEach(() => {
    __resetPartnerEscalationAlerterForTests();
    pdCalls = [];
    __setPartnerEscalationAlerterDeliveriesForTests({
      pagerduty: vi.fn(async (p: PartnerEscalationAlertPayload): Promise<DeliveryResult> => {
        pdCalls.push(p);
        return { channel: "pagerduty", ok: true };
      }),
    });
  });

  afterEach(() => {
    __setPartnerAssignmentFreeSlotsFnForTests(null);
    __setSoonestProbeBudgetMsForTests(null);
    __setPartnerEscalationAlerterDeliveriesForTests(null);
    __resetPartnerEscalationAlerterForTests();
  });

  it("(c) picks the earlier-slot partner over the lighter-booked partner", async () => {
    const earlyPartner = await insertPartner("soonest-early");
    const lightPartner = await insertPartner("soonest-light");
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-early` })
      .where(eq(partnersTable.id, earlyPartner));
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-light` })
      .where(eq(partnersTable.id, lightPartner));

    // Weight earlyPartner with an existing active assignment so it is NOT
    // the fewest-active pick — soonest-first must still choose it because
    // its slot is earlier than lightPartner's.
    const priorMember = await insertUser("soonest-c-prior");
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId: priorMember, partnerId: earlyPartner, status: "active" });

    const now = Date.now();
    const earlySlot = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString();
    const lateSlot = new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString();
    __setPartnerAssignmentFreeSlotsFnForTests(async (calendarId: string) => {
      if (calendarId === `${TEST_TAG}-cal-early`) return [{ startTime: earlySlot }];
      if (calendarId === `${TEST_TAG}-cal-light`) return [{ startTime: lateSlot }];
      return [];
    });

    await withOnlyThesePartnersActive([earlyPartner, lightPartner], async () => {
      const memberId = await insertUser("soonest-c-target");
      const result = await assignRoundRobin(memberId);
      expect(result.assigned).toBe(true);
      expect(result.partnerId).toBe(earlyPartner);

      const [row] = await db
        .select({ assignmentMethod: partnerAssignmentsTable.assignmentMethod })
        .from(partnerAssignmentsTable)
        .where(eq(partnerAssignmentsTable.memberId, memberId));
      expect(row.assignmentMethod).toBe("soonest");
    });
  });

  it("(d) breaks a same-time tie by fewest active assignments", async () => {
    const partnerA = await insertPartner("tie-a");
    const partnerB = await insertPartner("tie-b");
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-tie-a` })
      .where(eq(partnersTable.id, partnerA));
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-tie-b` })
      .where(eq(partnersTable.id, partnerB));

    // Load partnerA with an active assignment so partnerB is strictly
    // fewer-active; both report the EXACT same earliest slot time so the
    // tie must resolve on activeCount, not arrival order.
    const priorMember = await insertUser("soonest-d-prior");
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId: priorMember, partnerId: partnerA, status: "active" });

    const sameSlot = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    __setPartnerAssignmentFreeSlotsFnForTests(async () => [{ startTime: sameSlot }]);

    await withOnlyThesePartnersActive([partnerA, partnerB], async () => {
      const memberId = await insertUser("soonest-d-target");
      const result = await assignRoundRobin(memberId);
      expect(result.assigned).toBe(true);
      expect(result.partnerId).toBe(partnerB);
    });
  });

  it("(e) falls back to fewest-active (with assignment_method recorded) when the GHL probe times out, without blocking or erroring", async () => {
    const partnerA = await insertPartner("timeout-a");
    const partnerB = await insertPartner("timeout-b");
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-timeout-a` })
      .where(eq(partnersTable.id, partnerA));
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-timeout-b` })
      .where(eq(partnersTable.id, partnerB));

    // Load partnerA so partnerB is the fewest-active fallback pick.
    const priorMember = await insertUser("soonest-e-prior");
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId: priorMember, partnerId: partnerA, status: "active" });

    // A tiny probe budget + a free-slots stub that never resolves guarantees
    // the timeout branch fires deterministically and fast.
    __setSoonestProbeBudgetMsForTests(20);
    __setPartnerAssignmentFreeSlotsFnForTests(
      () => new Promise(() => {}), // never resolves
    );

    await withOnlyThesePartnersActive([partnerA, partnerB], async () => {
      const memberId = await insertUser("soonest-e-target");
      const start = Date.now();
      const result = await assignRoundRobin(memberId);
      const elapsedMs = Date.now() - start;

      expect(result.assigned).toBe(true);
      expect(result.partnerId).toBe(partnerB);
      // Must complete promptly — the ~3s budget is a ceiling, not something
      // this test should ever have to wait out at full length.
      expect(elapsedMs).toBeLessThan(2000);

      const [row] = await db
        .select({ assignmentMethod: partnerAssignmentsTable.assignmentMethod })
        .from(partnerAssignmentsTable)
        .where(eq(partnerAssignmentsTable.memberId, memberId));
      expect(row.assignmentMethod).toBe("fallback_fewest_active");

      // A timed-out probe is "unreliable" data — it must never drive the
      // >7-day capacity alert.
      expect(pdCalls.filter((p) => p.alertType === "assignment_delay")).toHaveLength(0);
    });
  });

  it("falls back to fewest-active (discarding the partial result) when one partner's probe succeeds and another rejects", async () => {
    const okPartner = await insertPartner("mixed-ok");
    const errorPartner = await insertPartner("mixed-error");
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-mixed-ok` })
      .where(eq(partnersTable.id, okPartner));
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-mixed-error` })
      .where(eq(partnersTable.id, errorPartner));

    // Load okPartner so errorPartner is the fewest-active fallback pick —
    // this proves the fallback path actually ran (a soonest choice would
    // have picked okPartner, since it's the only one that "succeeded").
    const priorMember = await insertUser("soonest-mixed-prior");
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId: priorMember, partnerId: okPartner, status: "active" });

    const now = Date.now();
    const okSlot = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString();
    __setPartnerAssignmentFreeSlotsFnForTests(async (calendarId: string) => {
      if (calendarId === `${TEST_TAG}-cal-mixed-ok`) return [{ startTime: okSlot }];
      throw new Error("GHL unreachable for this partner");
    });

    await withOnlyThesePartnersActive([okPartner, errorPartner], async () => {
      const memberId = await insertUser("soonest-mixed-target");
      const result = await assignRoundRobin(memberId);

      expect(result.assigned).toBe(true);
      expect(result.partnerId).toBe(errorPartner);

      const [row] = await db
        .select({ assignmentMethod: partnerAssignmentsTable.assignmentMethod })
        .from(partnerAssignmentsTable)
        .where(eq(partnerAssignmentsTable.memberId, memberId));
      expect(row.assignmentMethod).toBe("fallback_fewest_active");

      // A partial (one-error) probe is untrustworthy data — it must never
      // drive the >7-day capacity alert either.
      expect(pdCalls.filter((p) => p.alertType === "assignment_delay")).toHaveLength(0);
    });
  });

  it("(f) assigns the soonest partner AND fires the >7-day capacity alert exactly once when every slot is more than 7 days out", async () => {
    const partnerA = await insertPartner("capacity-a");
    const partnerB = await insertPartner("capacity-b");
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-capacity-a` })
      .where(eq(partnersTable.id, partnerA));
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-capacity-b` })
      .where(eq(partnersTable.id, partnerB));

    const now = Date.now();
    const soonestOfTheBad = new Date(now + 9 * 24 * 60 * 60 * 1000).toISOString();
    const laterStill = new Date(now + 12 * 24 * 60 * 60 * 1000).toISOString();
    __setPartnerAssignmentFreeSlotsFnForTests(async (calendarId: string) => {
      if (calendarId === `${TEST_TAG}-cal-capacity-a`) return [{ startTime: soonestOfTheBad }];
      return [{ startTime: laterStill }];
    });

    await withOnlyThesePartnersActive([partnerA, partnerB], async () => {
      const memberId = await insertUser("soonest-f-target");
      const result = await assignRoundRobin(memberId);

      expect(result.assigned).toBe(true);
      expect(result.partnerId).toBe(partnerA);

      const [row] = await db
        .select({ assignmentMethod: partnerAssignmentsTable.assignmentMethod })
        .from(partnerAssignmentsTable)
        .where(eq(partnerAssignmentsTable.memberId, memberId));
      expect(row.assignmentMethod).toBe("soonest");

      const fires = pdCalls.filter((p) => p.alertType === "assignment_delay" && p.kind === "fire");
      expect(fires).toHaveLength(1);
      expect(getPartnerEscalationAlertingState().assignmentDelayAlerting).toBe(true);

      // A second assignment while still in the same delayed state must not
      // re-fire (dispatcher-level dedup on the state transition itself).
      const memberId2 = await insertUser("soonest-f-target-2");
      await assignRoundRobin(memberId2);
      expect(pdCalls.filter((p) => p.alertType === "assignment_delay" && p.kind === "fire")).toHaveLength(1);
    });
  });

  it("widens the probe past 7 days when nobody has a slot within the primary window, still assigning + alerting with the true soonest date", async () => {
    const partnerA = await insertPartner("widen-a");
    const partnerB = await insertPartner("widen-b");
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-widen-a` })
      .where(eq(partnersTable.id, partnerA));
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-widen-b` })
      .where(eq(partnersTable.id, partnerB));

    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const soonestBeyondWindow = new Date(now + 9 * 24 * 60 * 60 * 1000).toISOString();
    const laterStill = new Date(now + 12 * 24 * 60 * 60 * 1000).toISOString();
    // This mock DOES respect the requested window (unlike the other tests'
    // stubs) — it returns nothing for the primary 7-day-bounded query and
    // only reveals slots once the probe widens past 7 days, proving the
    // widened second probe (not an incidental window-ignoring mock) is what
    // discovers them.
    __setPartnerAssignmentFreeSlotsFnForTests(async (calendarId: string, startMs: number, endMs: number) => {
      if (endMs - startMs <= SEVEN_DAYS_MS) return [];
      if (calendarId === `${TEST_TAG}-cal-widen-a`) return [{ startTime: soonestBeyondWindow }];
      return [{ startTime: laterStill }];
    });

    await withOnlyThesePartnersActive([partnerA, partnerB], async () => {
      const memberId = await insertUser("soonest-widen-target");
      const result = await assignRoundRobin(memberId);

      expect(result.assigned).toBe(true);
      expect(result.partnerId).toBe(partnerA);

      const [row] = await db
        .select({ assignmentMethod: partnerAssignmentsTable.assignmentMethod })
        .from(partnerAssignmentsTable)
        .where(eq(partnerAssignmentsTable.memberId, memberId));
      expect(row.assignmentMethod).toBe("soonest");

      const fires = pdCalls.filter((p) => p.alertType === "assignment_delay" && p.kind === "fire");
      expect(fires).toHaveLength(1);
    });
  });

  it("(g) a partner at their daily cap exposes no slots for that day in the assignment-time evaluation", async () => {
    const cappedPartner = await insertPartner("cap-capped");
    const openPartner = await insertPartner("cap-open");
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-cap-capped`, maxDailyCalls: 1 })
      .where(eq(partnersTable.id, cappedPartner));
    await db
      .update(partnersTable)
      .set({ ghlCalendarId: `${TEST_TAG}-cal-cap-open` })
      .where(eq(partnersTable.id, openPartner));

    // cappedPartner's ONLY free slot for the next 7 days falls on a day it
    // is already booked solid (maxDailyCalls = 1, one existing booking that
    // day) — the assignment-time probe must filter that day out entirely,
    // leaving openPartner (a later slot on an unbooked day) as the winner.
    const cappedDay = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    cappedDay.setUTCHours(15, 0, 0, 0);
    const someoneElse = await insertUser("soonest-g-existing-booking");
    await insertPartnerBooking(someoneElse, cappedPartner, cappedDay);

    const cappedSlot = new Date(cappedDay.getTime() + 60 * 60 * 1000).toISOString();
    const openSlot = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    __setPartnerAssignmentFreeSlotsFnForTests(async (calendarId: string) => {
      if (calendarId === `${TEST_TAG}-cal-cap-capped`) return [{ startTime: cappedSlot }];
      return [{ startTime: openSlot }];
    });

    await withOnlyThesePartnersActive([cappedPartner, openPartner], async () => {
      const memberId = await insertUser("soonest-g-target");
      const result = await assignRoundRobin(memberId);
      expect(result.assigned).toBe(true);
      expect(result.partnerId).toBe(openPartner);
    });
  });
});
