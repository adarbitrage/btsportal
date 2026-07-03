import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  partnersTable,
  partnerAssignmentsTable,
  callBookingsTable,
  productsTable,
  userProductsTable,
  auditLogTable,
} from "@workspace/db";
import { and, eq, inArray, gt, desc, isNotNull } from "drizzle-orm";
import {
  evaluateNoShowEscalations,
  evaluateVanishRule,
  evaluateFleetCapacity,
  getPartnerEscalationAlertingState,
  __resetPartnerEscalationAlerterForTests,
  __setPartnerEscalationAlerterDeliveriesForTests,
  __setPartnerEscalationFreeSlotsFnForTests,
  PARTNER_NO_SHOW_ALERT_ACTION_TYPE,
  PARTNER_VANISH_ALERT_ACTION_TYPE,
  PARTNER_CAPACITY_ALERT_ACTION_TYPE,
  PARTNER_ESCALATION_ALERT_ENTITY_TYPE,
  NO_SHOW_ESCALATION_THRESHOLD,
  VANISH_DAYS_THRESHOLD,
  type DeliveryResult,
  type PartnerEscalationAlertPayload,
} from "../lib/partner-escalation-alerter";

// Task #1629 (T9): no-show escalation, vanish rule, and fleet capacity
// alerts for the accountability-partner program. These tests exercise the
// evaluators against real DB fixtures (mirroring the partner-dashboard /
// partner-assignment test fixture style) so the shared no-show/days-since
// extraction (partner-escalation-metrics.ts) and the fleet-capacity math
// are pinned end to end, not just unit-tested in isolation.

const TEST_TAG = `partner-esc-${randomUUID().slice(0, 8)}`;
const DAY_MS = 24 * 60 * 60 * 1000;

const seededUserIds: number[] = [];
const seededPartnerIds: number[] = [];
const seededBookingIds: number[] = [];
let threeMonthProductId: number;

interface StubDelivery {
  fn: (p: PartnerEscalationAlertPayload) => Promise<DeliveryResult>;
  calls: PartnerEscalationAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: PartnerEscalationAlertPayload[] = [];
  const fn = vi.fn(
    async (p: PartnerEscalationAlertPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, ok: true };
    },
  );
  return { fn, calls };
}

async function seedMember(suffix: string, extra: Partial<typeof usersTable.$inferInsert> = {}): Promise<number> {
  const passwordHash = "irrelevant-test-hash";
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-${suffix}@example.test`,
      name: `Test ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: "3month",
      emailVerified: true,
      onboardingComplete: true,
      ...extra,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function insertPartner(
  suffix: string,
  opts: { isActive?: boolean; maxDailyCalls?: number; ghlCalendarId?: string | null } = {},
): Promise<number> {
  const [row] = await db
    .insert(partnersTable)
    .values({
      displayName: `Partner ${suffix} ${TEST_TAG}`,
      isActive: opts.isActive ?? true,
      maxDailyCalls: opts.maxDailyCalls ?? 5,
      ghlCalendarId: opts.ghlCalendarId === undefined ? `test-cal-${TEST_TAG}-${suffix}` : opts.ghlCalendarId,
    })
    .returning({ id: partnersTable.id });
  seededPartnerIds.push(row.id);
  return row.id;
}

async function insertBooking(
  memberId: number,
  partnerId: number,
  opts: { scheduledAt?: Date; status?: string } = {},
): Promise<number> {
  const scheduledAt = opts.scheduledAt ?? new Date();
  const [row] = await db
    .insert(callBookingsTable)
    .values({
      memberId,
      staffType: "partner",
      staffId: partnerId,
      type: "partner",
      ghlCalendarId: `test-cal-${TEST_TAG}`,
      scheduledAt,
      endAt: new Date(scheduledAt.getTime() + 30 * 60000),
      durationMinutes: 30,
      status: opts.status ?? "booked",
    })
    .returning({ id: callBookingsTable.id });
  seededBookingIds.push(row.id);
  return row.id;
}

async function grantThreeMonth(memberId: number): Promise<void> {
  await db.insert(userProductsTable).values({
    userId: memberId,
    productId: threeMonthProductId,
    status: "active",
  });
}

async function assignPartner(memberId: number, partnerId: number, assignedAt?: Date): Promise<void> {
  await db.insert(partnerAssignmentsTable).values({
    memberId,
    partnerId,
    status: "active",
    assignedAt: assignedAt ?? new Date(),
  });
}

let baselineAuditId = 0;

async function fetchAlertRows(actionType: string) {
  return db
    .select()
    .from(auditLogTable)
    .where(and(gt(auditLogTable.id, baselineAuditId), eq(auditLogTable.actionType, actionType)))
    .orderBy(desc(auditLogTable.id));
}

beforeAll(async () => {
  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, "3month"))
    .limit(1);
  if (!product) {
    throw new Error("Expected a seeded '3month' product for partner-escalation-alerter tests");
  }
  threeMonthProductId = product.id;

  const [maxRow] = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.id))
    .limit(1);
  baselineAuditId = maxRow?.id ?? 0;
});

afterAll(async () => {
  if (seededBookingIds.length > 0) {
    await db.delete(callBookingsTable).where(inArray(callBookingsTable.id, seededBookingIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(partnerAssignmentsTable).where(inArray(partnerAssignmentsTable.memberId, seededUserIds));
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
  }
  if (seededPartnerIds.length > 0) {
    await db.delete(partnersTable).where(inArray(partnersTable.id, seededPartnerIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  await db
    .delete(auditLogTable)
    .where(
      and(
        gt(auditLogTable.id, baselineAuditId),
        inArray(auditLogTable.actionType, [
          PARTNER_NO_SHOW_ALERT_ACTION_TYPE,
          PARTNER_VANISH_ALERT_ACTION_TYPE,
          PARTNER_CAPACITY_ALERT_ACTION_TYPE,
        ]),
      ),
    );
});

let pd: StubDelivery;
let email: StubDelivery;
let slack: StubDelivery;

// Each evaluator scans its ENTIRE respective table with no per-test scoping
// (that's the real production behavior: no-show escalation, the vanish
// rule, and fleet capacity are all fleet-wide checks). To keep tests
// independent, every test's fixtures are torn down immediately afterward
// (not just once in a trailing afterAll) so a later test's fleet-wide scan
// never sees an earlier test's partners/bookings/members still lingering.
async function cleanupSeededFixtures(): Promise<void> {
  if (seededBookingIds.length > 0) {
    await db.delete(callBookingsTable).where(inArray(callBookingsTable.id, seededBookingIds));
    seededBookingIds.length = 0;
  }
  if (seededUserIds.length > 0) {
    await db.delete(partnerAssignmentsTable).where(inArray(partnerAssignmentsTable.memberId, seededUserIds));
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
  }
  if (seededPartnerIds.length > 0) {
    await db.delete(partnersTable).where(inArray(partnersTable.id, seededPartnerIds));
    seededPartnerIds.length = 0;
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
    seededUserIds.length = 0;
  }
}

beforeEach(() => {
  __resetPartnerEscalationAlerterForTests();
  pd = makeStub("pagerduty");
  email = makeStub("email");
  slack = makeStub("slack");
  __setPartnerEscalationAlerterDeliveriesForTests({
    pagerduty: pd.fn,
    email: email.fn,
    slack: slack.fn,
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  __setPartnerEscalationAlerterDeliveriesForTests(null);
  __setPartnerEscalationFreeSlotsFnForTests(null);
  vi.restoreAllMocks();
  await cleanupSeededFixtures();
});

describe("evaluateNoShowEscalations", () => {
  it("fires once a member hits the 3rd consecutive no-show, using the shared computeConsecutiveNoShows logic", async () => {
    const partnerId = await insertPartner("noshow-a");
    const memberId = await seedMember("noshow-a");

    const base = Date.now() - 5 * DAY_MS;
    await insertBooking(memberId, partnerId, { status: "no_show", scheduledAt: new Date(base) });
    await insertBooking(memberId, partnerId, { status: "no_show", scheduledAt: new Date(base + DAY_MS) });

    // Only 2 consecutive no-shows so far — no fire yet.
    let results = await evaluateNoShowEscalations();
    expect(pd.calls).toHaveLength(0);
    expect(results.filter((r) => r.channel === "pagerduty")).toHaveLength(0);

    await insertBooking(memberId, partnerId, { status: "no_show", scheduledAt: new Date(base + 2 * DAY_MS) });

    results = await evaluateNoShowEscalations();
    const fires = pd.calls.filter((c) => c.alertType === "no_show" && c.kind === "fire");
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ memberId, consecutiveNoShows: NO_SHOW_ESCALATION_THRESHOLD });
    expect(getPartnerEscalationAlertingState().noShowAlertingMemberIds).toContain(memberId);

    const rows = await fetchAlertRows(PARTNER_NO_SHOW_ALERT_ACTION_TYPE);
    const memberRows = rows.filter((r) => (r.metadata as Record<string, unknown>).memberId === memberId);
    expect(memberRows.length).toBeGreaterThan(0);
    for (const row of memberRows) {
      expect(row.entityType).toBe(PARTNER_ESCALATION_ALERT_ENTITY_TYPE);
      expect(row.entityId).toBe(`partner-noshow:${memberId}`);
    }
  });

  it("does not re-fire on repeated polls while still at 3+ consecutive no-shows", async () => {
    const partnerId = await insertPartner("noshow-b");
    const memberId = await seedMember("noshow-b");
    const base = Date.now() - 5 * DAY_MS;
    for (let i = 0; i < 3; i++) {
      await insertBooking(memberId, partnerId, { status: "no_show", scheduledAt: new Date(base + i * DAY_MS) });
    }

    await evaluateNoShowEscalations();
    await evaluateNoShowEscalations();
    await evaluateNoShowEscalations();

    const fires = pd.calls.filter((c) => c.alertType === "no_show" && c.memberId === memberId && c.kind === "fire");
    expect(fires).toHaveLength(1);
  });

  it("clears the escalation once the member completes a call", async () => {
    const partnerId = await insertPartner("noshow-c");
    const memberId = await seedMember("noshow-c");
    const base = Date.now() - 5 * DAY_MS;
    for (let i = 0; i < 3; i++) {
      await insertBooking(memberId, partnerId, { status: "no_show", scheduledAt: new Date(base + i * DAY_MS) });
    }
    await evaluateNoShowEscalations();
    expect(pd.calls.filter((c) => c.alertType === "no_show" && c.memberId === memberId && c.kind === "fire")).toHaveLength(1);

    await insertBooking(memberId, partnerId, { status: "completed", scheduledAt: new Date() });
    await evaluateNoShowEscalations();

    const clears = pd.calls.filter((c) => c.alertType === "no_show" && c.memberId === memberId && c.kind === "clear");
    expect(clears).toHaveLength(1);
    expect(getPartnerEscalationAlertingState().noShowAlertingMemberIds).not.toContain(memberId);
  });
});

describe("evaluateVanishRule", () => {
  it("fires for an active 3-Month+ member with an active assignment and no completed call in 14+ days", async () => {
    const partnerId = await insertPartner("vanish-a");
    const memberId = await seedMember("vanish-a");
    await grantThreeMonth(memberId);
    await assignPartner(memberId, partnerId, new Date(Date.now() - (VANISH_DAYS_THRESHOLD + 5) * DAY_MS));

    const results = await evaluateVanishRule();

    const fires = pd.calls.filter((c) => c.alertType === "vanish" && c.kind === "fire");
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ memberId });
    expect((fires[0] as { daysSinceLastCall: number }).daysSinceLastCall).toBeGreaterThanOrEqual(VANISH_DAYS_THRESHOLD);
    expect(results.some((r) => r.channel === "pagerduty")).toBe(true);

    const rows = await fetchAlertRows(PARTNER_VANISH_ALERT_ACTION_TYPE);
    const memberRows = rows.filter((r) => (r.metadata as Record<string, unknown>).memberId === memberId);
    expect(memberRows.length).toBeGreaterThan(0);
    for (const row of memberRows) {
      expect(row.entityId).toBe(`partner-vanish:${memberId}`);
    }
  });

  it("does not fire for a member with a recent completed call", async () => {
    const partnerId = await insertPartner("vanish-b");
    const memberId = await seedMember("vanish-b");
    await grantThreeMonth(memberId);
    await assignPartner(memberId, partnerId, new Date(Date.now() - 30 * DAY_MS));
    await insertBooking(memberId, partnerId, { status: "completed", scheduledAt: new Date(Date.now() - 2 * DAY_MS) });

    await evaluateVanishRule();

    expect(pd.calls.filter((c) => c.alertType === "vanish" && c.memberId === memberId)).toHaveLength(0);
  });

  it("does not fire for a member without an active 3-Month+ product, even with a stale assignment", async () => {
    const partnerId = await insertPartner("vanish-c");
    const memberId = await seedMember("vanish-c");
    // No grantThreeMonth() call — member has no qualifying active product.
    await assignPartner(memberId, partnerId, new Date(Date.now() - (VANISH_DAYS_THRESHOLD + 10) * DAY_MS));

    await evaluateVanishRule();

    expect(pd.calls.filter((c) => c.alertType === "vanish" && c.memberId === memberId)).toHaveLength(0);
  });

  it("pins the 14-day boundary deterministically against an injected `now` (13.99 days no fire, 14.01 days fires)", async () => {
    const partnerId = await insertPartner("vanish-boundary");
    const memberId = await seedMember("vanish-boundary");
    await grantThreeMonth(memberId);

    const fixedNow = Date.UTC(2026, 0, 15, 12, 0, 0);
    const assignedAt = new Date(fixedNow - VANISH_DAYS_THRESHOLD * DAY_MS + 15 * 60 * 1000);
    await assignPartner(memberId, partnerId, assignedAt);

    // 13.99 days elapsed at the injected instant — must NOT fire, regardless
    // of the real wall clock while the test runs.
    await evaluateVanishRule(fixedNow);
    expect(pd.calls.filter((c) => c.alertType === "vanish" && c.memberId === memberId)).toHaveLength(0);

    // Same rows, evaluated 30 minutes later (14.01 days) — must fire, with
    // daysSinceLastCall computed against the injected now, not Date.now().
    const laterNow = fixedNow + 30 * 60 * 1000;
    await evaluateVanishRule(laterNow);
    const fires = pd.calls.filter((c) => c.alertType === "vanish" && c.memberId === memberId && c.kind === "fire");
    expect(fires).toHaveLength(1);
    expect((fires[0] as { daysSinceLastCall: number }).daysSinceLastCall).toBe(VANISH_DAYS_THRESHOLD);
  });

  it("clears once the member completes a partner call", async () => {
    const partnerId = await insertPartner("vanish-d");
    const memberId = await seedMember("vanish-d");
    await grantThreeMonth(memberId);
    await assignPartner(memberId, partnerId, new Date(Date.now() - (VANISH_DAYS_THRESHOLD + 5) * DAY_MS));

    await evaluateVanishRule();
    expect(pd.calls.filter((c) => c.alertType === "vanish" && c.kind === "fire")).toHaveLength(1);

    await insertBooking(memberId, partnerId, { status: "completed", scheduledAt: new Date() });
    await evaluateVanishRule();

    const clears = pd.calls.filter((c) => c.alertType === "vanish" && c.memberId === memberId && c.kind === "clear");
    expect(clears).toHaveLength(1);
    expect(getPartnerEscalationAlertingState().vanishAlertingMemberIds).not.toContain(memberId);
  });
});

describe("evaluateFleetCapacity", () => {
  // Fleet capacity is intentionally fleet-wide (real production partners
  // like Jean/Mikha/John/Neil are seeded with an active ghlCalendarId), so
  // it can't be scoped to just this test's fixtures the way the no-show and
  // vanish evaluators can (those filter down to specific member ids). To
  // get deterministic ratios, temporarily deactivate every pre-existing
  // active+calendared partner for the duration of this describe block, then
  // restore them exactly as found.
  let preexistingActivePartnerIds: number[] = [];

  beforeAll(async () => {
    const rows = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(and(eq(partnersTable.isActive, true), isNotNull(partnersTable.ghlCalendarId)));
    preexistingActivePartnerIds = rows.map((r) => r.id);
    if (preexistingActivePartnerIds.length > 0) {
      await db
        .update(partnersTable)
        .set({ isActive: false })
        .where(inArray(partnersTable.id, preexistingActivePartnerIds));
    }
  });

  afterAll(async () => {
    if (preexistingActivePartnerIds.length > 0) {
      await db
        .update(partnersTable)
        .set({ isActive: true })
        .where(inArray(partnersTable.id, preexistingActivePartnerIds));
    }
  });

  it("fires when trailing-7-day booked/available ratio reaches 80%, capped per partner per day by maxDailyCalls", async () => {
    const partnerId = await insertPartner("cap-a", { maxDailyCalls: 2 });
    const memberId = await seedMember("cap-a");

    // 8 booked calls in the trailing 7 days (non-canceled).
    for (let i = 0; i < 8; i++) {
      await insertBooking(memberId, partnerId, {
        status: "completed",
        scheduledAt: new Date(Date.now() - i * (DAY_MS / 2)),
      });
    }
    // A canceled booking must NOT count toward "booked".
    await insertBooking(memberId, partnerId, { status: "canceled", scheduledAt: new Date() });

    // GHL reports 5 free slots/day for 7 days = 35 raw, but the partner's
    // maxDailyCalls=2 caps it to 14 available. 8/14 ≈ 57%... use a helper
    // that reports exactly 5/day but assert the cap brings it to 2/day = 14
    // total, then bump booked further to cross 80% (>= 11.2, so 12 booked).
    __setPartnerEscalationFreeSlotsFnForTests(async (_calendarId, startMs, endMs) => {
      const slots: { startTime: string }[] = [];
      for (let t = startMs; t < endMs; t += DAY_MS) {
        for (let n = 0; n < 5; n++) {
          slots.push({ startTime: new Date(t).toISOString() });
        }
      }
      return slots;
    });

    // Push booked count up so ratio (booked / 14 available) >= 0.8.
    for (let i = 0; i < 4; i++) {
      await insertBooking(memberId, partnerId, {
        status: "completed",
        scheduledAt: new Date(Date.now() - i * (DAY_MS / 3)),
      });
    }

    const results = await evaluateFleetCapacity();

    const fires = pd.calls.filter((c) => c.alertType === "capacity" && c.kind === "fire");
    expect(fires).toHaveLength(1);
    const payload = fires[0] as { availableSlots: number; bookedSlots: number; ratioPct: number };
    expect(payload.availableSlots).toBe(14);
    expect(payload.bookedSlots).toBeGreaterThanOrEqual(12);
    expect(payload.ratioPct).toBeGreaterThanOrEqual(80);
    expect(results.some((r) => r.channel === "pagerduty")).toBe(true);

    const rows = await fetchAlertRows(PARTNER_CAPACITY_ALERT_ACTION_TYPE);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].entityId).toBe("partner-capacity-fleet");
  });

  it("does not fire when the ratio is below 80%", async () => {
    const partnerId = await insertPartner("cap-b", { maxDailyCalls: 5 });
    const memberId = await seedMember("cap-b");
    await insertBooking(memberId, partnerId, { status: "completed", scheduledAt: new Date() });

    __setPartnerEscalationFreeSlotsFnForTests(async (_calendarId, startMs, endMs) => {
      const slots: { startTime: string }[] = [];
      for (let t = startMs; t < endMs; t += DAY_MS) {
        for (let n = 0; n < 5; n++) slots.push({ startTime: new Date(t).toISOString() });
      }
      return slots;
    });

    const results = await evaluateFleetCapacity();

    expect(pd.calls.filter((c) => c.alertType === "capacity" && c.kind === "fire")).toHaveLength(0);
    expect(results).toEqual([]);
  });

  it("excludes inactive partners from both the booked and available sides", async () => {
    const activePartnerId = await insertPartner("cap-c-active", { maxDailyCalls: 3 });
    const inactivePartnerId = await insertPartner("cap-c-inactive", { isActive: false, maxDailyCalls: 100 });
    const memberId = await seedMember("cap-c");

    // Heavy booking against the INACTIVE partner should not count.
    for (let i = 0; i < 20; i++) {
      await insertBooking(memberId, inactivePartnerId, {
        status: "completed",
        scheduledAt: new Date(Date.now() - i * (DAY_MS / 4)),
      });
    }
    await insertBooking(memberId, activePartnerId, { status: "completed", scheduledAt: new Date() });

    const seenCalendarIds: string[] = [];
    __setPartnerEscalationFreeSlotsFnForTests(async (calendarId, startMs, endMs) => {
      seenCalendarIds.push(calendarId);
      const slots: { startTime: string }[] = [];
      for (let t = startMs; t < endMs; t += DAY_MS) {
        slots.push({ startTime: new Date(t).toISOString() });
      }
      return slots;
    });

    await evaluateFleetCapacity();

    expect(seenCalendarIds).toHaveLength(1);
    expect(pd.calls.filter((c) => c.alertType === "capacity" && c.kind === "fire")).toHaveLength(0);
  });

  it("does not fire when free-slot data is incomplete due to a partial fetch failure", async () => {
    const okPartnerId = await insertPartner("cap-fail-ok", { maxDailyCalls: 5 });
    const failingPartnerId = await insertPartner("cap-fail-bad", { maxDailyCalls: 5 });
    const memberId = await seedMember("cap-fail");

    // Heavy booking that WOULD cross 80% if the denominator were undercounted
    // by the failing partner's missing slots.
    for (let i = 0; i < 10; i++) {
      await insertBooking(memberId, okPartnerId, {
        status: "completed",
        scheduledAt: new Date(Date.now() - i * (DAY_MS / 4)),
      });
    }

    __setPartnerEscalationFreeSlotsFnForTests(async (calendarId, startMs, endMs) => {
      if (calendarId.includes("cap-fail-bad")) {
        throw new Error("simulated GHL fetch failure");
      }
      const slots: { startTime: string }[] = [];
      for (let t = startMs; t < endMs; t += DAY_MS) {
        for (let n = 0; n < 5; n++) slots.push({ startTime: new Date(t).toISOString() });
      }
      return slots;
    });

    const results = await evaluateFleetCapacity();

    expect(pd.calls.filter((c) => c.alertType === "capacity")).toHaveLength(0);
    expect(results).toEqual([]);
    expect(getPartnerEscalationAlertingState().capacityAlerting).toBe(false);

    void failingPartnerId;
  });

  it("does not clear an already-firing capacity alert when a later poll's free-slot fetch fails entirely", async () => {
    const partnerId = await insertPartner("cap-recover", { maxDailyCalls: 2 });
    const memberId = await seedMember("cap-recover");

    for (let i = 0; i < 12; i++) {
      await insertBooking(memberId, partnerId, {
        status: "completed",
        scheduledAt: new Date(Date.now() - i * (DAY_MS / 4)),
      });
    }

    __setPartnerEscalationFreeSlotsFnForTests(async (_calendarId, startMs, endMs) => {
      const slots: { startTime: string }[] = [];
      for (let t = startMs; t < endMs; t += DAY_MS) {
        for (let n = 0; n < 2; n++) slots.push({ startTime: new Date(t).toISOString() });
      }
      return slots;
    });
    await evaluateFleetCapacity();
    expect(getPartnerEscalationAlertingState().capacityAlerting).toBe(true);

    // Now the GHL lookup fails entirely on the next poll — a naive
    // implementation would compute availableSlots=0 and incorrectly clear.
    __setPartnerEscalationFreeSlotsFnForTests(async () => {
      throw new Error("simulated total GHL outage");
    });
    const results = await evaluateFleetCapacity();

    expect(pd.calls.filter((c) => c.alertType === "capacity" && c.kind === "clear")).toHaveLength(0);
    expect(results).toEqual([]);
    expect(getPartnerEscalationAlertingState().capacityAlerting).toBe(true);
  });
});
